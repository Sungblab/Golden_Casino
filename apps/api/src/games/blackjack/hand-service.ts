import type { PoolClient } from "pg";
import { COIN_SCALE, type BlackjackBetCommand, type BlackjackHandStatus, type BlackjackOutcome, type Card } from "@golden/contracts";
import { payoutForOutcome, settleHand } from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";

export interface BlackjackHandRow {
  id: string;
  userId: string;
  betMinor: number;
  cards: Card[];
  status: BlackjackHandStatus;
}

export interface BlackjackWin {
  userId: string;
  outcome: BlackjackOutcome;
  payoutMinor: number;
}

export class BlackjackHandService {
  /** Places this round's single bet for a player (idempotent by requestId, one hand per user per round). */
  async place(userId: string, command: BlackjackBetCommand, minBet: number, maxBet: number): Promise<{ duplicate: boolean; balance: number }> {
    if (command.amount < minBet || command.amount > maxBet) throw new Error("BET_LIMIT");
    const amountMinor = command.amount * COIN_SCALE;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`bj-bet:${command.requestId}`]);
      const round = await client.query<{ phase: string; room_id: string }>("SELECT phase,room_id FROM blackjack_rounds WHERE id=$1 FOR UPDATE", [command.roundId]);
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== command.roomId) throw new Error("BETTING_CLOSED");
      const existing = await client.query("SELECT id FROM blackjack_hands WHERE request_id=$1", [command.requestId]);
      if (existing.rowCount) {
        const matching = await client.query(
          "SELECT 1 FROM blackjack_hands WHERE request_id=$1 AND user_id=$2 AND room_id=$3 AND round_id=$4 AND bet_minor=$5",
          [command.requestId, userId, command.roomId, command.roundId, amountMinor],
        );
        if (!matching.rowCount) throw new Error("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { duplicate: true, balance: await walletService.getUserBalance(userId) };
      }
      const already = await client.query("SELECT 1 FROM blackjack_hands WHERE round_id=$1 AND user_id=$2", [command.roundId, userId]);
      if (already.rowCount) throw new Error("BET_ALREADY_PLACED");
      const accounts = await walletService.accountIds(client, userId, command.roomId);
      await walletService.postTransaction(client, {
        type: "BJ_BET_RESERVED",
        idempotencyKey: `bj-bet:${command.requestId}`,
        referenceType: "blackjack_hand",
        referenceId: command.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -amountMinor },
          { accountId: accounts.room, amountMinor },
        ],
        metadata: { roundId: command.roundId },
      });
      await client.query(
        "INSERT INTO blackjack_hands (id,round_id,room_id,user_id,request_id,bet_minor) VALUES ($1,$2,$3,$4,$1,$5)",
        [command.requestId, command.roundId, command.roomId, userId, amountMinor],
      );
      await client.query("COMMIT");
      return { duplicate: false, balance: await walletService.getUserBalance(userId) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Doubles down: reserves a second, matching wager against the same hand (call before drawing the extra card). */
  async placeDouble(userId: string, roomId: string, roundId: string, handId: string, betMinor: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accounts = await walletService.accountIds(client, userId, roomId);
      await walletService.postTransaction(client, {
        type: "BJ_DOUBLE_RESERVED",
        idempotencyKey: `bj-double:${handId}`,
        referenceType: "blackjack_hand",
        referenceId: handId,
        entries: [
          { accountId: accounts.user, amountMinor: -betMinor },
          { accountId: accounts.room, amountMinor: betMinor },
        ],
        metadata: { roundId },
      });
      await client.query("UPDATE blackjack_hands SET bet_minor=bet_minor+$2 WHERE id=$1", [handId, betMinor]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async handsForRound(roundId: string): Promise<BlackjackHandRow[]> {
    const result = await pool.query<{ id: string; user_id: string; bet_minor: string; cards: Card[]; status: BlackjackHandStatus }>(
      "SELECT id,user_id,bet_minor,cards,status FROM blackjack_hands WHERE round_id=$1 ORDER BY placed_at",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, betMinor: Number(row.bet_minor), cards: row.cards, status: row.status }));
  }

  async syncHand(handId: string, cards: Card[], status: BlackjackHandStatus): Promise<void> {
    await pool.query("UPDATE blackjack_hands SET cards=$2,status=$3 WHERE id=$1", [handId, JSON.stringify(cards), status]);
  }

  async recordDealer(roundId: string, cards: Card[], score: number | null): Promise<void> {
    await pool.query("UPDATE blackjack_rounds SET dealer_cards=$2,dealer_score=$3 WHERE id=$1", [roundId, JSON.stringify(cards), score]);
  }

  async settle(roomId: string, roundId: string, dealerCards: Card[]): Promise<{ balances: Map<string, number>; wins: BlackjackWin[] }> {
    const hands = await this.handsForRound(roundId);
    const balances = new Map<string, number>();
    const wins: BlackjackWin[] = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const hand of hands) {
        const outcome: BlackjackOutcome = settleHand(hand.cards, hand.status, dealerCards);
        const payoutMinor = payoutForOutcome(outcome, hand.betMinor);
        const accounts = await walletService.accountIds(client, hand.userId, roomId);
        const entries = payoutMinor === 0
          ? [{ accountId: accounts.room, amountMinor: -hand.betMinor }, { accountId: accounts.house, amountMinor: hand.betMinor }]
          : [
              { accountId: accounts.room, amountMinor: -hand.betMinor },
              { accountId: accounts.user, amountMinor: payoutMinor },
              ...(payoutMinor > hand.betMinor ? [{ accountId: accounts.house, amountMinor: -(payoutMinor - hand.betMinor) }] : []),
            ];
        await walletService.postTransaction(client, {
          type: "BJ_HAND_SETTLED",
          idempotencyKey: `bj-settle:${hand.id}`,
          referenceType: "blackjack_hand",
          referenceId: hand.id,
          entries,
          metadata: { outcome },
        });
        await client.query("UPDATE blackjack_hands SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [hand.id, payoutMinor, outcome]);
        if (payoutMinor > hand.betMinor) wins.push({ userId: hand.userId, outcome, payoutMinor });
      }
      await client.query("COMMIT");
      for (const userId of new Set(hands.map((hand) => hand.userId))) balances.set(userId, await walletService.getUserBalance(userId));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { balances, wins };
  }

  async recoverInterruptedRounds(): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('golden:blackjack-round-recovery'))");
      const rounds = await client.query<{ id: string; room_id: string }>(
        "SELECT id,room_id FROM blackjack_rounds WHERE settled_at IS NULL AND phase NOT IN ('RESULT','ABORTED') FOR UPDATE",
      );
      for (const round of rounds.rows) await this.refundRoundWithClient(client, round.id, round.room_id);
      await client.query("COMMIT");
      return rounds.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async refundRound(roundId: string, roomId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await this.refundRoundWithClient(client, roundId, roomId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async refundRoundWithClient(client: PoolClient, roundId: string, roomId: string): Promise<void> {
    const hands = await client.query<{ id: string; user_id: string; bet_minor: string }>(
      "SELECT id,user_id,bet_minor FROM blackjack_hands WHERE round_id=$1 AND settled_at IS NULL FOR UPDATE",
      [roundId],
    );
    for (const hand of hands.rows) {
      const betMinor = Number(hand.bet_minor);
      const accounts = await walletService.accountIds(client, hand.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BJ_HAND_REFUNDED",
        idempotencyKey: `bj-refund:${hand.id}`,
        referenceType: "blackjack_hand",
        referenceId: hand.id,
        entries: [
          { accountId: accounts.room, amountMinor: -betMinor },
          { accountId: accounts.user, amountMinor: betMinor },
        ],
        metadata: { reason: "round_interrupted" },
      });
      await client.query("UPDATE blackjack_hands SET payout_minor=bet_minor,outcome='push',settled_at=now() WHERE id=$1", [hand.id]);
    }
    await client.query("UPDATE blackjack_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
  }
}

export const blackjackHandService = new BlackjackHandService();
