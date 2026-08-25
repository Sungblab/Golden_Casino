import type { PoolClient } from "pg";
import {
  COIN_SCALE,
  type BlackjackBehindBetCommand,
  type BlackjackBetCommand,
  type BlackjackHandStatus,
  type BlackjackInsuranceCommand,
  type BlackjackOutcome,
  type Card,
} from "@golden/contracts";
import {
  applyLightningBlackjackMultiplier,
  drawLightningBlackjackMultiplier,
  insurancePayout,
  payoutForOutcome,
  settleHand,
} from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { wageringService } from "../../wallet/wagering-service.js";

export interface BlackjackHandRow {
  id: string;
  userId: string;
  seatNumber: number;
  handIndex: number;
  fromSplit: boolean;
  splitAces: boolean;
  betMinor: number;
  lightningFeeMinor: number;
  lightningMultiplier: number;
  cards: Card[];
  status: BlackjackHandStatus;
}

export interface BlackjackInsuranceRow {
  id: string;
  userId: string;
  handId: string;
  amountMinor: number;
  outcome: "win" | "lose" | null;
}

export interface BlackjackBehindBetRow {
  id: string;
  userId: string;
  targetHandId: string;
  targetSeat: number;
  amountMinor: number;
  outcome: BlackjackOutcome | null;
}

export interface BlackjackWin {
  userId: string;
  outcome: BlackjackOutcome | "insurance";
  profitMinor: number;
}

/** Moves the reserved stake out of the room account and balances the exact player return.
 * This also covers partial returns such as late surrender (half the stake). */
export function buildBlackjackSettlementEntries(
  accounts: { room: string; user: string; house: string },
  stakeMinor: number,
  payoutMinor: number,
): Array<{ accountId: string; amountMinor: number }> {
  const houseMinor = stakeMinor - payoutMinor;
  return [
    { accountId: accounts.room, amountMinor: -stakeMinor },
    ...(payoutMinor > 0 ? [{ accountId: accounts.user, amountMinor: payoutMinor }] : []),
    ...(houseMinor !== 0 ? [{ accountId: accounts.house, amountMinor: houseMinor }] : []),
  ];
}

export class BlackjackHandService {
  /** Adds one idempotent chip increment to this round's hand. */
  async place(
    userId: string,
    command: BlackjackBetCommand,
    seatNumber: number,
    minBet: number,
    maxBet: number,
    lightning = false,
  ): Promise<{ duplicate: boolean; balance: number; handId: string; totalBet: number; lightningMultiplier: number }> {
    if (!Number.isInteger(command.amount) || command.amount <= 0 || command.amount > maxBet) throw new Error("BET_LIMIT");
    const amountMinor = command.amount * COIN_SCALE;
    const feeMinor = lightning ? amountMinor : 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`bj-bet:${command.requestId}`]);
      const round = await client.query<{ phase: string; room_id: string }>("SELECT phase,room_id FROM blackjack_rounds WHERE id=$1 FOR UPDATE", [command.roundId]);
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== command.roomId) throw new Error("BETTING_CLOSED");
      const previousIncrement = await client.query<{ hand_id: string; amount_minor: string; room_id: string; round_id: string; seat_number: number }>(
        `SELECT i.hand_id,i.amount_minor,h.room_id,h.round_id,h.seat_number
         FROM blackjack_bet_increments i JOIN blackjack_hands h ON h.id=i.hand_id
         WHERE i.request_id=$1 AND i.user_id=$2`,
        [command.requestId, userId],
      );
      if (previousIncrement.rows[0]) {
        const prior = previousIncrement.rows[0];
        if (Number(prior.amount_minor) !== amountMinor || prior.room_id !== command.roomId || prior.round_id !== command.roundId || prior.seat_number !== seatNumber) throw new Error("IDEMPOTENCY_CONFLICT");
        const total = await client.query<{ bet_minor: string; lightning_multiplier: number }>("SELECT bet_minor,lightning_multiplier FROM blackjack_hands WHERE id=$1", [previousIncrement.rows[0].hand_id]);
        await client.query("COMMIT");
        return { duplicate: true, balance: await walletService.getUserBalance(userId), handId: previousIncrement.rows[0].hand_id, totalBet: Number(total.rows[0]!.bet_minor) / COIN_SCALE, lightningMultiplier: total.rows[0]!.lightning_multiplier };
      }
      const current = await client.query<{ id: string; bet_minor: string; seat_number: number; lightning_multiplier: number }>(
        "SELECT id,bet_minor,seat_number,lightning_multiplier FROM blackjack_hands WHERE round_id=$1 AND user_id=$2 AND hand_index=0 FOR UPDATE",
        [command.roundId, userId],
      );
      const handId = current.rows[0]?.id ?? command.requestId;
      const currentMinor = Number(current.rows[0]?.bet_minor ?? 0);
      if (current.rows[0] && current.rows[0].seat_number !== seatNumber) throw new Error("SEAT_TAKEN");
      if (!current.rows[0] && command.amount < minBet) throw new Error("BET_LIMIT");
      if (currentMinor + amountMinor > maxBet * COIN_SCALE) throw new Error("BET_LIMIT");
      if (!current.rows[0]) {
        const occupied = await client.query("SELECT 1 FROM blackjack_hands WHERE round_id=$1 AND seat_number=$2 AND hand_index=0", [command.roundId, seatNumber]);
        if (occupied.rowCount) throw new Error("SEAT_TAKEN");
      }
      const accounts = await walletService.accountIds(client, userId, command.roomId);
      let lightningMultiplier = current.rows[0]?.lightning_multiplier ?? 1;
      if (lightning && !current.rows[0]) {
        const award = await client.query<{ multiplier: number }>(
          "SELECT multiplier FROM blackjack_lightning_awards WHERE user_id=$1 AND expires_at>now() FOR UPDATE",
          [userId],
        );
        lightningMultiplier = award.rows[0]?.multiplier ?? 1;
        if (award.rows[0]) await client.query("DELETE FROM blackjack_lightning_awards WHERE user_id=$1", [userId]);
      }
      await walletService.postTransaction(client, {
        type: "BJ_BET_RESERVED",
        idempotencyKey: `bj-bet:${command.requestId}`,
        referenceType: "blackjack_hand",
        referenceId: handId,
        entries: [
          { accountId: accounts.user, amountMinor: -(amountMinor + feeMinor) },
          { accountId: accounts.room, amountMinor },
          ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: feeMinor }] : []),
        ],
        metadata: { roundId: command.roundId, lightningFeeMinor: feeMinor, lightningMultiplier },
      });
      if (current.rows[0]) await client.query("UPDATE blackjack_hands SET bet_minor=bet_minor+$2,lightning_fee_minor=lightning_fee_minor+$3 WHERE id=$1", [handId, amountMinor, feeMinor]);
      else await client.query(
        "INSERT INTO blackjack_hands (id,round_id,room_id,user_id,request_id,seat_number,bet_minor,lightning_fee_minor,lightning_multiplier) VALUES ($1,$2,$3,$4,$1,$5,$6,$7,$8)",
        [handId, command.roundId, command.roomId, userId, seatNumber, amountMinor, feeMinor, lightningMultiplier],
      );
      await client.query("INSERT INTO blackjack_bet_increments (request_id,hand_id,user_id,amount_minor) VALUES ($1,$2,$3,$4)", [command.requestId, handId, userId, amountMinor]);
      await client.query("COMMIT");
      return { duplicate: false, balance: await walletService.getUserBalance(userId), handId, totalBet: (currentMinor + amountMinor) / COIN_SCALE, lightningMultiplier };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Reserves an independent wager that follows the final outcome of an occupied seat's hand. */
  async placeBehind(
    userId: string,
    command: BlackjackBehindBetCommand,
    targetHandId: string,
    minBet: number,
    maxBet: number,
  ): Promise<{ duplicate: boolean; balance: number; betId: string; totalBet: number }> {
    if (!Number.isInteger(command.amount) || command.amount <= 0 || command.amount > maxBet) throw new Error("BET_LIMIT");
    const amountMinor = command.amount * COIN_SCALE;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`bj-behind:${command.requestId}`]);
      const round = await client.query<{ phase: string; room_id: string }>("SELECT phase,room_id FROM blackjack_rounds WHERE id=$1 FOR UPDATE", [command.roundId]);
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== command.roomId) throw new Error("BETTING_CLOSED");
      const target = await client.query<{ user_id: string; seat_number: number }>(
        "SELECT user_id,seat_number FROM blackjack_hands WHERE id=$1 AND round_id=$2 AND room_id=$3 FOR UPDATE",
        [targetHandId, command.roundId, command.roomId],
      );
      if (!target.rows[0] || target.rows[0].seat_number !== command.targetSeat) throw new Error("FOLLOW_TARGET_UNAVAILABLE");
      if (target.rows[0].user_id === userId) throw new Error("CANNOT_FOLLOW_SELF");

      const previousIncrement = await client.query<{ bet_id: string; amount_minor: string; room_id: string; round_id: string; target_hand_id: string; target_seat: number }>(
        `SELECT i.bet_id,i.amount_minor,b.room_id,b.round_id,b.target_hand_id,b.target_seat
         FROM blackjack_behind_bet_increments i JOIN blackjack_behind_bets b ON b.id=i.bet_id
         WHERE i.request_id=$1 AND i.user_id=$2`,
        [command.requestId, userId],
      );
      if (previousIncrement.rows[0]) {
        const prior = previousIncrement.rows[0];
        if (Number(prior.amount_minor) !== amountMinor || prior.room_id !== command.roomId || prior.round_id !== command.roundId || prior.target_hand_id !== targetHandId || prior.target_seat !== command.targetSeat) throw new Error("IDEMPOTENCY_CONFLICT");
        const total = await client.query<{ amount_minor: string }>("SELECT amount_minor FROM blackjack_behind_bets WHERE id=$1", [previousIncrement.rows[0].bet_id]);
        await client.query("COMMIT");
        return { duplicate: true, balance: await walletService.getUserBalance(userId), betId: previousIncrement.rows[0].bet_id, totalBet: Number(total.rows[0]!.amount_minor) / COIN_SCALE };
      }
      const current = await client.query<{ id: string; amount_minor: string; target_hand_id: string }>(
        "SELECT id,amount_minor,target_hand_id FROM blackjack_behind_bets WHERE round_id=$1 AND user_id=$2 AND target_seat=$3 FOR UPDATE",
        [command.roundId, userId, command.targetSeat],
      );
      const betId = current.rows[0]?.id ?? command.requestId;
      const currentMinor = Number(current.rows[0]?.amount_minor ?? 0);
      if (current.rows[0] && current.rows[0].target_hand_id !== targetHandId) throw new Error("FOLLOW_TARGET_UNAVAILABLE");
      if (!current.rows[0] && command.amount < minBet) throw new Error("BET_LIMIT");
      if (currentMinor + amountMinor > maxBet * COIN_SCALE) throw new Error("BET_LIMIT");

      const accounts = await walletService.accountIds(client, userId, command.roomId);
      await walletService.postTransaction(client, {
        type: "BJ_BEHIND_RESERVED",
        idempotencyKey: `bj-behind:${command.requestId}`,
        referenceType: "blackjack_behind_bet",
        referenceId: betId,
        entries: [
          { accountId: accounts.user, amountMinor: -amountMinor },
          { accountId: accounts.room, amountMinor },
        ],
        metadata: { roundId: command.roundId, targetSeat: command.targetSeat, targetHandId },
      });
      if (current.rows[0]) await client.query("UPDATE blackjack_behind_bets SET amount_minor=amount_minor+$2 WHERE id=$1", [betId, amountMinor]);
      else await client.query(
        "INSERT INTO blackjack_behind_bets (id,round_id,room_id,user_id,target_hand_id,target_seat,request_id,amount_minor) VALUES ($1,$2,$3,$4,$5,$6,$1,$7)",
        [betId, command.roundId, command.roomId, userId, targetHandId, command.targetSeat, amountMinor],
      );
      await client.query("INSERT INTO blackjack_behind_bet_increments (request_id,bet_id,user_id,amount_minor) VALUES ($1,$2,$3,$4)", [command.requestId, betId, userId, amountMinor]);
      await client.query("COMMIT");
      return { duplicate: false, balance: await walletService.getUserBalance(userId), betId, totalBet: (currentMinor + amountMinor) / COIN_SCALE };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Doubles down once and leaves retries idempotent at both the ledger and hand row. */
  async placeDouble(userId: string, roomId: string, roundId: string, handId: string, betMinor: number): Promise<{ duplicate: boolean }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const accounts = await walletService.accountIds(client, userId, roomId);
      const transaction = await walletService.postTransaction(client, {
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
      if (!transaction.duplicate) await client.query("UPDATE blackjack_hands SET bet_minor=bet_minor+$2 WHERE id=$1", [handId, betMinor]);
      await client.query("COMMIT");
      return { duplicate: transaction.duplicate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async placeInsurance(
    userId: string,
    command: BlackjackInsuranceCommand,
    handId: string,
    betMinor: number,
  ): Promise<{ duplicate: boolean; amount: number }> {
    const amountMinor = Math.floor(betMinor / (2 * COIN_SCALE)) * COIN_SCALE;
    if (amountMinor <= 0) throw new Error("INSURANCE_NOT_ALLOWED");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ phase: string; room_id: string }>("SELECT phase,room_id FROM blackjack_rounds WHERE id=$1 FOR UPDATE", [command.roundId]);
      if (round.rows[0]?.phase !== "INSURANCE" || round.rows[0]?.room_id !== command.roomId) throw new Error("INSURANCE_CLOSED");
      const existing = await client.query<{ request_id: string; amount_minor: string }>(
        "SELECT request_id,amount_minor FROM blackjack_insurance_bets WHERE round_id=$1 AND user_id=$2 FOR UPDATE",
        [command.roundId, userId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_id !== command.requestId) throw new Error("INSURANCE_ALREADY_TAKEN");
        await client.query("COMMIT");
        return { duplicate: true, amount: Number(existing.rows[0].amount_minor) / COIN_SCALE };
      }
      const accounts = await walletService.accountIds(client, userId, command.roomId);
      await walletService.postTransaction(client, {
        type: "BJ_INSURANCE_RESERVED",
        idempotencyKey: `bj-insurance:${command.requestId}`,
        referenceType: "blackjack_insurance",
        referenceId: command.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -amountMinor },
          { accountId: accounts.room, amountMinor },
        ],
        metadata: { roundId: command.roundId, handId },
      });
      await client.query(
        "INSERT INTO blackjack_insurance_bets (id,round_id,room_id,user_id,hand_id,request_id,amount_minor) VALUES ($1,$2,$3,$4,$5,$1,$6)",
        [command.requestId, command.roundId, command.roomId, userId, handId, amountMinor],
      );
      await client.query("COMMIT");
      return { duplicate: false, amount: amountMinor / COIN_SCALE };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async splitHand(input: {
    userId: string;
    roomId: string;
    roundId: string;
    requestId: string;
    handId: string;
    seatNumber: number;
    nextHandIndex: number;
    betMinor: number;
    originalCard: Card;
    splitCard: Card;
    splitAces: boolean;
    lightningMultiplier: number;
  }): Promise<{ duplicate: boolean; newHandId: string }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ phase: string; room_id: string }>("SELECT phase,room_id FROM blackjack_rounds WHERE id=$1 FOR UPDATE", [input.roundId]);
      if (round.rows[0]?.phase !== "PLAYER_TURN" || round.rows[0]?.room_id !== input.roomId) throw new Error("NOT_YOUR_TURN");
      const previous = await client.query<{ id: string }>("SELECT id FROM blackjack_hands WHERE request_id=$1", [input.requestId]);
      if (previous.rows[0]) {
        await client.query("COMMIT");
        return { duplicate: true, newHandId: previous.rows[0].id };
      }
      const original = await client.query<{ user_id: string; bet_minor: string; status: string }>(
        "SELECT user_id,bet_minor,status FROM blackjack_hands WHERE id=$1 AND round_id=$2 FOR UPDATE",
        [input.handId, input.roundId],
      );
      if (!original.rows[0] || original.rows[0].user_id !== input.userId || original.rows[0].status !== "playing" || Number(original.rows[0].bet_minor) !== input.betMinor) throw new Error("SPLIT_NOT_ALLOWED");
      const handCount = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM blackjack_hands WHERE round_id=$1 AND user_id=$2", [input.roundId, input.userId]);
      if (Number(handCount.rows[0]!.count) >= 4) throw new Error("SPLIT_LIMIT");
      const accounts = await walletService.accountIds(client, input.userId, input.roomId);
      await walletService.postTransaction(client, {
        type: "BJ_SPLIT_RESERVED",
        idempotencyKey: `bj-split:${input.requestId}`,
        referenceType: "blackjack_hand",
        referenceId: input.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -input.betMinor },
          { accountId: accounts.room, amountMinor: input.betMinor },
        ],
        metadata: { roundId: input.roundId, sourceHandId: input.handId },
      });
      await client.query(
        "UPDATE blackjack_hands SET cards=$2,from_split=true,split_aces=$3,parent_hand_id=COALESCE(parent_hand_id,id) WHERE id=$1",
        [input.handId, JSON.stringify([input.originalCard]), input.splitAces],
      );
      await client.query(
        `INSERT INTO blackjack_hands
         (id,round_id,room_id,user_id,request_id,seat_number,hand_index,parent_hand_id,from_split,split_aces,bet_minor,lightning_multiplier,cards,status)
         VALUES ($1,$2,$3,$4,$1,$5,$6,$7,true,$8,$9,$10,$11,'playing')`,
        [input.requestId, input.roundId, input.roomId, input.userId, input.seatNumber, input.nextHandIndex, input.handId, input.splitAces, input.betMinor, input.lightningMultiplier, JSON.stringify([input.splitCard])],
      );
      await client.query("COMMIT");
      return { duplicate: false, newHandId: input.requestId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async handsForRound(roundId: string): Promise<BlackjackHandRow[]> {
    const result = await pool.query<{ id: string; user_id: string; seat_number: number; hand_index: number; from_split: boolean; split_aces: boolean; bet_minor: string; lightning_fee_minor: string; lightning_multiplier: number; cards: Card[]; status: BlackjackHandStatus }>(
      "SELECT id,user_id,seat_number,hand_index,from_split,split_aces,bet_minor,lightning_fee_minor,lightning_multiplier,cards,status FROM blackjack_hands WHERE round_id=$1 ORDER BY seat_number,hand_index",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, seatNumber: row.seat_number, handIndex: row.hand_index, fromSplit: row.from_split, splitAces: row.split_aces, betMinor: Number(row.bet_minor), lightningFeeMinor: Number(row.lightning_fee_minor), lightningMultiplier: row.lightning_multiplier, cards: row.cards, status: row.status }));
  }

  async insuranceForRound(roundId: string): Promise<BlackjackInsuranceRow[]> {
    const result = await pool.query<{ id: string; user_id: string; hand_id: string; amount_minor: string; outcome: "win" | "lose" | null }>(
      "SELECT id,user_id,hand_id,amount_minor,outcome FROM blackjack_insurance_bets WHERE round_id=$1 ORDER BY placed_at",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, handId: row.hand_id, amountMinor: Number(row.amount_minor), outcome: row.outcome }));
  }

  async behindBetsForRound(roundId: string): Promise<BlackjackBehindBetRow[]> {
    const result = await pool.query<{
      id: string;
      user_id: string;
      target_hand_id: string;
      target_seat: number;
      amount_minor: string;
      outcome: BlackjackOutcome | null;
    }>(
      "SELECT id,user_id,target_hand_id,target_seat,amount_minor,outcome FROM blackjack_behind_bets WHERE round_id=$1 ORDER BY placed_at",
      [roundId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      targetHandId: row.target_hand_id,
      targetSeat: row.target_seat,
      amountMinor: Number(row.amount_minor),
      outcome: row.outcome,
    }));
  }

  async syncHand(handId: string, cards: Card[], status: BlackjackHandStatus): Promise<void> {
    await pool.query("UPDATE blackjack_hands SET cards=$2,status=$3 WHERE id=$1", [handId, JSON.stringify(cards), status]);
  }

  async recordDealer(roundId: string, cards: Card[], score: number | null): Promise<void> {
    await pool.query("UPDATE blackjack_rounds SET dealer_cards=$2,dealer_score=$3 WHERE id=$1", [roundId, JSON.stringify(cards), score]);
  }

  async settle(
    roomId: string,
    roundId: string,
    dealerCards: Card[],
    lightning = false,
  ): Promise<{ balances: Map<string, number>; wins: BlackjackWin[]; lightningAwards: Map<string, number> }> {
    const hands = await this.handsForRound(roundId);
    const behindBets = await this.behindBetsForRound(roundId);
    const insuranceBets = await this.insuranceForRound(roundId);
    const balances = new Map<string, number>();
    const wins: BlackjackWin[] = [];
    const lightningAwards = new Map<string, number>();
    const lightningWinners = new Set<string>();
    const targetOutcomes = new Map<string, BlackjackOutcome>();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const hand of hands) {
        const outcome: BlackjackOutcome = settleHand(hand.cards, hand.status, dealerCards, { fromSplit: hand.fromSplit });
        targetOutcomes.set(hand.id, outcome);
        const basePayoutMinor = payoutForOutcome(outcome, hand.betMinor, COIN_SCALE);
        const payoutMinor = lightning
          ? applyLightningBlackjackMultiplier(basePayoutMinor, hand.betMinor, hand.lightningMultiplier)
          : basePayoutMinor;
        const accounts = await walletService.accountIds(client, hand.userId, roomId);
        const entries = buildBlackjackSettlementEntries(accounts, hand.betMinor, payoutMinor);
        await walletService.postTransaction(client, {
          type: "BJ_HAND_SETTLED",
          idempotencyKey: `bj-settle:${hand.id}`,
          referenceType: "blackjack_hand",
          referenceId: hand.id,
          entries,
          metadata: { outcome, lightningMultiplier: hand.lightningMultiplier },
        });
        if (outcome !== "push" && outcome !== "surrender") await wageringService.applyEligibleWager(client, hand.userId, "blackjack_hand", hand.id, hand.betMinor);
        await client.query("UPDATE blackjack_hands SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [hand.id, payoutMinor, outcome]);
        if (payoutMinor > hand.betMinor) {
          wins.push({ userId: hand.userId, outcome, profitMinor: payoutMinor - hand.betMinor });
          if (lightning) lightningWinners.add(hand.userId);
        }
      }
      for (const behind of behindBets) {
        const outcome = targetOutcomes.get(behind.targetHandId);
        if (!outcome) throw new Error("FOLLOW_TARGET_UNAVAILABLE");
        const payoutMinor = payoutForOutcome(outcome, behind.amountMinor, COIN_SCALE);
        const accounts = await walletService.accountIds(client, behind.userId, roomId);
        const entries = buildBlackjackSettlementEntries(accounts, behind.amountMinor, payoutMinor);
        await walletService.postTransaction(client, {
          type: "BJ_BEHIND_SETTLED",
          idempotencyKey: `bj-behind-settle:${behind.id}`,
          referenceType: "blackjack_behind_bet",
          referenceId: behind.id,
          entries,
          metadata: { outcome, targetSeat: behind.targetSeat, targetHandId: behind.targetHandId },
        });
        if (outcome !== "push" && outcome !== "surrender") await wageringService.applyEligibleWager(client, behind.userId, "blackjack_behind", behind.id, behind.amountMinor);
        await client.query(
          "UPDATE blackjack_behind_bets SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1",
          [behind.id, payoutMinor, outcome],
        );
        if (payoutMinor > behind.amountMinor) wins.push({ userId: behind.userId, outcome, profitMinor: payoutMinor - behind.amountMinor });
      }
      for (const insurance of insuranceBets) {
        const payoutMinor = insurancePayout(insurance.amountMinor, dealerCards);
        const outcome = payoutMinor > 0 ? "win" : "lose";
        const accounts = await walletService.accountIds(client, insurance.userId, roomId);
        const entries = payoutMinor === 0
          ? [{ accountId: accounts.room, amountMinor: -insurance.amountMinor }, { accountId: accounts.house, amountMinor: insurance.amountMinor }]
          : [
              { accountId: accounts.room, amountMinor: -insurance.amountMinor },
              { accountId: accounts.user, amountMinor: payoutMinor },
              { accountId: accounts.house, amountMinor: -(payoutMinor - insurance.amountMinor) },
            ];
        await walletService.postTransaction(client, {
          type: "BJ_INSURANCE_SETTLED",
          idempotencyKey: `bj-insurance-settle:${insurance.id}`,
          referenceType: "blackjack_insurance",
          referenceId: insurance.id,
          entries,
          metadata: { outcome },
        });
        await wageringService.applyEligibleWager(client, insurance.userId, "blackjack_insurance", insurance.id, insurance.amountMinor);
        await client.query("UPDATE blackjack_insurance_bets SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [insurance.id, payoutMinor, outcome]);
        if (payoutMinor > insurance.amountMinor) wins.push({ userId: insurance.userId, outcome: "insurance", profitMinor: payoutMinor - insurance.amountMinor });
      }
      for (const userId of lightningWinners) {
        const generated = drawLightningBlackjackMultiplier();
        const award = await client.query<{ multiplier: number }>(
          `INSERT INTO blackjack_lightning_awards (user_id,multiplier,source_round_id,expires_at)
           VALUES ($1,$2,$3,now()+interval '180 days')
           ON CONFLICT (user_id) DO UPDATE SET
             multiplier=CASE WHEN blackjack_lightning_awards.source_round_id=EXCLUDED.source_round_id THEN blackjack_lightning_awards.multiplier ELSE EXCLUDED.multiplier END,
             source_round_id=EXCLUDED.source_round_id,
             expires_at=CASE WHEN blackjack_lightning_awards.source_round_id=EXCLUDED.source_round_id THEN blackjack_lightning_awards.expires_at ELSE EXCLUDED.expires_at END,
             updated_at=now()
           RETURNING multiplier`,
          [userId, generated, roundId],
        );
        lightningAwards.set(userId, award.rows[0]!.multiplier);
      }
      await client.query("COMMIT");
      for (const userId of new Set([...hands.map((hand) => hand.userId), ...behindBets.map((bet) => bet.userId), ...insuranceBets.map((bet) => bet.userId)])) {
        balances.set(userId, await walletService.getUserBalance(userId));
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { balances, wins, lightningAwards };
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
    const insuranceBets = await client.query<{ id: string; user_id: string; amount_minor: string }>(
      "SELECT id,user_id,amount_minor FROM blackjack_insurance_bets WHERE round_id=$1 AND settled_at IS NULL FOR UPDATE",
      [roundId],
    );
    for (const bet of insuranceBets.rows) {
      const amountMinor = Number(bet.amount_minor);
      const accounts = await walletService.accountIds(client, bet.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BJ_INSURANCE_REFUNDED",
        idempotencyKey: `bj-insurance-refund:${bet.id}`,
        referenceType: "blackjack_insurance",
        referenceId: bet.id,
        entries: [
          { accountId: accounts.room, amountMinor: -amountMinor },
          { accountId: accounts.user, amountMinor },
        ],
        metadata: { reason: "round_interrupted" },
      });
      await client.query("UPDATE blackjack_insurance_bets SET payout_minor=amount_minor,settled_at=now() WHERE id=$1", [bet.id]);
    }
    const behindBets = await client.query<{ id: string; user_id: string; amount_minor: string }>(
      "SELECT id,user_id,amount_minor FROM blackjack_behind_bets WHERE round_id=$1 AND settled_at IS NULL FOR UPDATE",
      [roundId],
    );
    for (const bet of behindBets.rows) {
      const amountMinor = Number(bet.amount_minor);
      const accounts = await walletService.accountIds(client, bet.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BJ_BEHIND_REFUNDED",
        idempotencyKey: `bj-behind-refund:${bet.id}`,
        referenceType: "blackjack_behind_bet",
        referenceId: bet.id,
        entries: [
          { accountId: accounts.room, amountMinor: -amountMinor },
          { accountId: accounts.user, amountMinor },
        ],
        metadata: { reason: "round_interrupted" },
      });
      await client.query("UPDATE blackjack_behind_bets SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE id=$1", [bet.id]);
    }
    const hands = await client.query<{ id: string; user_id: string; bet_minor: string; lightning_fee_minor: string; lightning_multiplier: number }>(
      "SELECT id,user_id,bet_minor,lightning_fee_minor,lightning_multiplier FROM blackjack_hands WHERE round_id=$1 AND settled_at IS NULL FOR UPDATE",
      [roundId],
    );
    for (const hand of hands.rows) {
      const betMinor = Number(hand.bet_minor);
      const feeMinor = Number(hand.lightning_fee_minor);
      const accounts = await walletService.accountIds(client, hand.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BJ_HAND_REFUNDED",
        idempotencyKey: `bj-refund:${hand.id}`,
        referenceType: "blackjack_hand",
        referenceId: hand.id,
        entries: [
          { accountId: accounts.room, amountMinor: -betMinor },
          ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: -feeMinor }] : []),
          { accountId: accounts.user, amountMinor: betMinor + feeMinor },
        ],
        metadata: { reason: "round_interrupted" },
      });
      await client.query("UPDATE blackjack_hands SET payout_minor=bet_minor,outcome='push',settled_at=now() WHERE id=$1", [hand.id]);
      if (hand.lightning_multiplier > 1) {
        await client.query(
          `INSERT INTO blackjack_lightning_awards (user_id,multiplier,source_round_id,expires_at)
           VALUES ($1,$2,$3,now()+interval '180 days') ON CONFLICT (user_id) DO NOTHING`,
          [hand.user_id, hand.lightning_multiplier, roundId],
        );
      }
    }
    await client.query("UPDATE blackjack_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
  }
}

export const blackjackHandService = new BlackjackHandService();
