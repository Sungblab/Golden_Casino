import type { PoolClient } from "pg";
import { COIN_SCALE, type Card } from "@golden/contracts";
import { buildHoldemPots, comparePokerHands, evaluateBestHoldemHand, type PokerHandRank } from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { wageringService } from "../../wallet/wagering-service.js";

// 5% rake. The cap used to be a flat 3 coins, which happened to equal 3% of the rookie room's
// 100-coin max bet — but it stayed flat 3 coins for every tier, so a High Roller table (max bet
// 5,000, shared by both Hold'em and Sutda) capped rake at the same 3 coins as Rookie despite pots
// running 50x larger. Deriving the cap from the room's own max bet keeps that original 3%
// relationship intact and scales it with the tier instead.
const RAKE_PERCENT = 5;
const RAKE_CAP_PERCENT_OF_MAX_BET = 3;
export function rakeFor(potAmountMinor: number, maxBetMinor: number): number {
  const cap = Math.min(Math.floor((maxBetMinor * RAKE_CAP_PERCENT_OF_MAX_BET) / 100), maxBetMinor);
  return Math.min(Math.floor((potAmountMinor * RAKE_PERCENT) / 100), cap);
}

export interface HoldemSeatWin {
  userId: string;
  amountMinor: number;
  handCategory: PokerHandRank["category"] | null;
}

export class HoldemService {
  /** Idempotent: safe to call once per (round, user) contribution increment. */
  async contribute(
    client: PoolClient,
    input: { requestId: string; userId: string; roomId: string; roundId: string; seatNumber: number; amountMinor: number },
  ): Promise<{ duplicate: boolean }> {
    if (input.amountMinor <= 0) return { duplicate: false };
    const accounts = await walletService.accountIds(client, input.userId, input.roomId);
    const posted = await walletService.postTransaction(client, {
      type: "HOLDEM_CONTRIBUTE",
      idempotencyKey: `holdem-contribute:${input.requestId}`,
      referenceType: "holdem_round",
      referenceId: input.roundId,
      entries: [
        { accountId: accounts.user, amountMinor: -input.amountMinor },
        { accountId: accounts.room, amountMinor: input.amountMinor },
      ],
      metadata: { seatNumber: input.seatNumber },
    });
    if (!posted.duplicate) {
      await client.query(
        `INSERT INTO holdem_contributions (round_id,room_id,user_id,seat_number,amount_minor)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (round_id,user_id) DO UPDATE SET amount_minor = holdem_contributions.amount_minor + EXCLUDED.amount_minor`,
        [input.roundId, input.roomId, input.userId, input.seatNumber, input.amountMinor],
      );
    }
    return posted;
  }

  async recordHoleCards(roundId: string, userId: string, holeCards: Card[]): Promise<void> {
    await pool.query("UPDATE holdem_contributions SET hole_cards=$3 WHERE round_id=$1 AND user_id=$2", [roundId, userId, JSON.stringify(holeCards)]);
  }

  async markFolded(roundId: string, userId: string): Promise<void> {
    await pool.query("UPDATE holdem_contributions SET folded=true WHERE round_id=$1 AND user_id=$2", [roundId, userId]);
  }

  async markAllIn(roundId: string, userId: string, allIn: boolean): Promise<void> {
    await pool.query("UPDATE holdem_contributions SET all_in=$3 WHERE round_id=$1 AND user_id=$2", [roundId, userId, allIn]);
  }

  async contributions(roundId: string): Promise<Array<{ id: string; userId: string; seatNumber: number; amountMinor: number; folded: boolean; holeCards: Card[] }>> {
    const result = await pool.query<{ id: string; user_id: string; seat_number: number; amount_minor: string; folded: boolean; hole_cards: Card[] }>(
      "SELECT id,user_id,seat_number,amount_minor,folded,hole_cards FROM holdem_contributions WHERE round_id=$1",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, seatNumber: row.seat_number, amountMinor: Number(row.amount_minor), folded: row.folded, holeCards: row.hole_cards }));
  }

  /**
   * Splits every pot among the best eligible hand(s) (or the lone survivor if
   * everyone else folded), takes rake off the top of each pot into the house
   * account, and pays winners straight out of the room escrow. There is no
   * house counterparty on a loss — a losing contribution simply becomes part
   * of what the room escrow pays out to whoever beat it.
   */
  async settle(
    roomId: string,
    roundId: string,
    board: Card[],
    maxBetMinor: number,
  ): Promise<{ balances: Map<string, number>; winners: HoldemSeatWin[] }> {
    const contributions = await this.contributions(roundId);
    const active = contributions.filter((entry) => entry.amountMinor > 0);
    const pots = buildHoldemPots(active.map((entry) => ({ userId: entry.userId, amount: entry.amountMinor, folded: entry.folded })));
    const survivors = active.filter((entry) => !entry.folded);
    const handByUser = new Map<string, PokerHandRank>();
    if (survivors.length > 1) {
      for (const entry of survivors) handByUser.set(entry.userId, evaluateBestHoldemHand([...entry.holeCards, ...board]));
    }

    const payouts = new Map<string, number>();
    const winnerCategory = new Map<string, PokerHandRank["category"]>();
    for (const pot of pots) {
      if (pot.amount <= 0 || pot.eligibleUserIds.length === 0) continue;
      const rake = rakeFor(pot.amount, maxBetMinor);
      const distributable = pot.amount - rake;
      let winnerIds: string[];
      if (survivors.length <= 1) {
        winnerIds = pot.eligibleUserIds;
      } else {
        const eligibleHands = pot.eligibleUserIds.map((userId) => [userId, handByUser.get(userId)!] as const);
        const best = eligibleHands.reduce((champion, candidate) => (comparePokerHands(candidate[1], champion[1]) > 0 ? candidate : champion));
        winnerIds = eligibleHands.filter(([, hand]) => comparePokerHands(hand, best[1]) === 0).map(([userId]) => userId);
      }
      const share = Math.floor(distributable / winnerIds.length);
      const remainder = distributable - share * winnerIds.length;
      winnerIds.forEach((userId, index) => {
        payouts.set(userId, (payouts.get(userId) ?? 0) + share + (index === 0 ? remainder : 0));
        const hand = handByUser.get(userId);
        if (hand) winnerCategory.set(userId, hand.category);
      });
      payouts.set("__house__", (payouts.get("__house__") ?? 0) + rake);
    }

    const client = await pool.connect();
    const balances = new Map<string, number>();
    const winners: HoldemSeatWin[] = [];
    try {
      await client.query("BEGIN");
      const rakeMinor = payouts.get("__house__") ?? 0;
      const winnerEntries = [...payouts.entries()].filter(([userId]) => userId !== "__house__" && userId !== undefined);
      const totalPotMinor = active.reduce((sum, entry) => sum + entry.amountMinor, 0);
      const userIds = [...new Set(winnerEntries.map(([userId]) => userId))];
      const accountRows = await client.query<{ id: string; kind: string; user_id: string | null }>(
        `SELECT id,kind,user_id FROM wallet_accounts
         WHERE (kind='room' AND room_id=$1) OR kind='house' OR (kind='user' AND user_id=ANY($2::uuid[]))`,
        [roomId, userIds],
      );
      const roomAccountId = accountRows.rows.find((row) => row.kind === "room")?.id;
      const houseAccountId = accountRows.rows.find((row) => row.kind === "house")?.id;
      const userAccountId = new Map(accountRows.rows.filter((row) => row.kind === "user").map((row) => [row.user_id!, row.id]));
      if (!roomAccountId || !houseAccountId) throw new Error("Wallet account configuration is incomplete");

      await walletService.postTransaction(client, {
        type: "HOLDEM_SETTLED",
        idempotencyKey: `holdem-settle:${roundId}`,
        referenceType: "holdem_round",
        referenceId: roundId,
        entries: [
          { accountId: roomAccountId, amountMinor: -totalPotMinor },
          ...(rakeMinor > 0 ? [{ accountId: houseAccountId, amountMinor: rakeMinor }] : []),
          ...winnerEntries.map(([userId, amountMinor]) => {
            const accountId = userAccountId.get(userId);
            if (!accountId) throw new Error("Wallet account configuration is incomplete");
            return { accountId, amountMinor };
          }),
        ],
        metadata: { board, potsCount: pots.length, rakeMinor },
      });

      for (const entry of contributions) {
        const payoutMinor = payouts.get(entry.userId) ?? 0;
        const outcome = payoutMinor === entry.amountMinor ? "push" : payoutMinor > entry.amountMinor ? "win" : "lose";
        await client.query(
          "UPDATE holdem_contributions SET payout_minor=$2,outcome=$3,settled_at=now() WHERE round_id=$1 AND user_id=$4",
          [roundId, payoutMinor, outcome, entry.userId],
        );
        if (payoutMinor > entry.amountMinor) winners.push({ userId: entry.userId, amountMinor: payoutMinor - entry.amountMinor, handCategory: winnerCategory.get(entry.userId) ?? null });
        // Wagering credit is capped to this hand's share of rake, not the full pot — crediting
        // the whole stake would let two colluding accounts launder deposits by playing each other.
        if (rakeMinor > 0 && totalPotMinor > 0) {
          const rakeShare = Math.floor((rakeMinor * entry.amountMinor) / totalPotMinor);
          if (rakeShare > 0) await wageringService.applyEligibleWager(client, entry.userId, "holdem_rake", entry.id, rakeShare);
        }
      }
      await client.query("COMMIT");
      for (const entry of contributions) balances.set(entry.userId, await walletService.getUserBalance(entry.userId));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { balances, winners };
  }

  /**
   * Runs once at process startup, before any room actor exists in memory. A hand in flight when
   * the process died has no in-memory actor to catch and refund it (that only happens for crashes
   * *during* a live process — see the room manager's launchCycle) — this is the restart case.
   * Must run before the generic cross-game sweep in RoomManager.initialize(), which would
   * otherwise mark a stuck Hold'em round ABORTED without knowing to refund its pot at all.
   *
   * A hand whose board had already been fully dealt (river persisted to result_data — see
   * HoldemRoomActor.dealStreet) before the crash is *settled* here from that persisted board,
   * not refunded: the outcome was already fully determined, so refunding it would unfairly deny
   * the winner(s) their pot. A hand interrupted before the river genuinely cannot be resumed —
   * the shoe's remaining draw order only ever lived in process memory (never persisted, since
   * doing so would hand a card-counting/collusion tool to anyone with database access) — so those
   * still fall back to a full refund, same as every other game's crash recovery.
   */
  async recoverInterruptedRounds(): Promise<{ settled: number; refunded: number }> {
    const client = await pool.connect();
    let stuckRounds: Array<{ id: string; room_id: string; max_bet: number; result_data: { board?: Card[] } }>;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('golden:holdem-round-recovery'))");
      const rounds = await client.query<{ id: string; room_id: string; max_bet: number; result_data: { board?: Card[] } }>(
        `SELECT gr.id,gr.room_id,gm.max_bet,gr.result_data FROM game_rounds gr
         JOIN game_rooms gm ON gm.id=gr.room_id
         WHERE gr.settled_at IS NULL AND gr.phase NOT IN ('RESULT','ABORTED') AND gr.rules_version='holdem-v1' FOR UPDATE`,
      );
      stuckRounds = rounds.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let settled = 0;
    let refunded = 0;
    for (const round of stuckRounds) {
      const board = round.result_data?.board ?? [];
      const contributions = board.length === 5 ? await this.contributions(round.id) : [];
      const canSettle = board.length === 5 && contributions
        .filter((entry) => !entry.folded && entry.amountMinor > 0)
        .every((entry) => entry.holeCards.length === 2);
      if (canSettle) {
        await this.settle(round.room_id, round.id, board, round.max_bet * COIN_SCALE);
        // settle() only finalizes holdem_contributions — the room actor normally marks the round
        // itself RESULT/settled right after calling settle(). Recovery has no actor, so it must
        // do that step itself, or one_active_round_per_room blocks every future hand in this room
        // and the next restart re-processes the same round (settle() is idempotent, so harmless,
        // but still pointless work every time until this is fixed).
        await pool.query("UPDATE game_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [round.id]);
        settled += 1;
      } else {
        await this.refundRound(round.id, round.room_id);
        refunded += 1;
      }
    }
    return { settled, refunded };
  }

  /** Crash recovery: refunds every un-settled contribution for a hand back to its owner. */
  async refundRound(roundId: string, roomId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ user_id: string; amount_minor: string }>(
        "SELECT user_id,amount_minor FROM holdem_contributions WHERE round_id=$1 AND settled_at IS NULL AND amount_minor > 0 FOR UPDATE",
        [roundId],
      );
      for (const row of rows.rows) {
        const accounts = await walletService.accountIds(client, row.user_id, roomId);
        const amountMinor = Number(row.amount_minor);
        await walletService.postTransaction(client, {
          type: "HOLDEM_REFUNDED",
          idempotencyKey: `holdem-refund:${roundId}:${row.user_id}`,
          referenceType: "holdem_round",
          referenceId: roundId,
          entries: [
            { accountId: accounts.room, amountMinor: -amountMinor },
            { accountId: accounts.user, amountMinor },
          ],
          metadata: { reason: "round_processing_failed" },
        });
        await client.query(
          "UPDATE holdem_contributions SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE round_id=$1 AND user_id=$2",
          [roundId, row.user_id],
        );
      }
      // one_active_round_per_room only allows one un-settled game_rounds row per room — without
      // this, every hand after a crash fails to even start with a duplicate-key error, forever.
      await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export const holdemService = new HoldemService();
