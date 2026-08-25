import {
  COIN_SCALE,
  type BaccaratBetChoice,
  type DragonTigerBetChoice,
  type DragonTigerBetCommand,
  type PlaceBetCommand,
  type RoundHistoryEntry,
} from "@golden/contracts";
import {
  lightningFee,
  payoutForBaccaratBet,
  payoutForDragonTigerBet,
  payoutForLightningBaccaratBet,
  type BaccaratResult,
  type DragonTigerResult,
  type LightningCard,
} from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { wageringService } from "../../wallet/wagering-service.js";
import type { PoolClient } from "pg";

type AutomaticBetChoice = BaccaratBetChoice | DragonTigerBetChoice;
type AutomaticBetCommand = PlaceBetCommand | DragonTigerBetCommand;

export interface AutomaticTableWin {
  userId: string;
  choice: AutomaticBetChoice;
  profitMinor: number;
}
export type BaccaratWin = AutomaticTableWin;

/**
 * Proposition bets whose payout multiplier (11:1 pairs, 50:1 Suited Tie) turns an ordinary-looking
 * stake into disproportionate house exposure — these are capped by the room's side_bet_max instead
 * of its main max_bet, same as a real casino's side-bet limits. Tie is deliberately excluded even
 * though its 8:1/11:1 payout is also elevated: it's treated as a third main outcome (Player/Banker/Tie),
 * not a side bet, matching standard table convention.
 */
const SIDE_BET_CHOICES: ReadonlySet<AutomaticBetChoice> = new Set(["player_pair", "banker_pair", "suited_tie"]);

export class BaccaratBetService {
  async place(userId: string, command: AutomaticBetCommand, minBet: number, maxBet: number, feePercent: 0 | 20 = 0, sideBetMax: number | null = null): Promise<{ duplicate: boolean; balance: number }> {
    const effectiveMax = sideBetMax !== null && SIDE_BET_CHOICES.has(command.choice) ? sideBetMax : maxBet;
    if (!Number.isInteger(command.amount) || command.amount <= 0 || command.amount > effectiveMax) throw new Error("BET_LIMIT");
    const amountMinor = command.amount * COIN_SCALE;
    const feeMinor = lightningFee(amountMinor, feePercent, COIN_SCALE);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`wager:${command.requestId}`]);
      const round = await client.query<{ phase: string; room_id: string }>(
        "SELECT phase,room_id FROM game_rounds WHERE id=$1 FOR UPDATE",
        [command.roundId],
      );
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== command.roomId) throw new Error("BETTING_CLOSED");
      const existing = await client.query("SELECT id FROM wagers WHERE request_id=$1", [command.requestId]);
      if (existing.rowCount) {
        const matching = await client.query(
          `SELECT 1 FROM wagers
           WHERE request_id=$1 AND user_id=$2 AND room_id=$3 AND round_id=$4 AND choice=$5 AND amount_minor=$6 AND fee_minor=$7`,
          [command.requestId, userId, command.roomId, command.roundId, command.choice, amountMinor, feeMinor],
        );
        if (!matching.rowCount) throw new Error("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { duplicate: true, balance: await walletService.getUserBalance(userId) };
      }
      // Scoped to this choice, not the round: a real table's limit applies per betting spot, so a
      // player at the room max on Player can still separately bet up to the (lower) side-bet cap
      // on Player Pair. This was previously summed across every choice in the round, which meant
      // *any* two simultaneous bets together could trip the room limit even though neither alone
      // came close — invisible at the old wide limits, but immediate once side_bet_max made the
      // combination realistic (e.g. Rookie's 20-coin main bet + a 5-coin pair bet already exceeds a
      // round-wide 20-coin sum).
      const accumulated = await client.query<{ total: string }>(
        "SELECT COALESCE(SUM(amount_minor),0) AS total FROM wagers WHERE round_id=$1 AND user_id=$2 AND choice=$3 AND status='accepted'",
        [command.roundId, userId, command.choice],
      );
      const accumulatedMinor = Number(accumulated.rows[0]!.total);
      // The room minimum only gates the first chip on a choice — side bets keep the same floor
      // as the main table (no separate side_bet_min), only their ceiling is lower.
      if (accumulatedMinor === 0 && command.amount < minBet) throw new Error("BET_LIMIT");
      if (accumulatedMinor + amountMinor > effectiveMax * COIN_SCALE) throw new Error("BET_LIMIT");
      const accounts = await walletService.accountIds(client, userId, command.roomId);
      await walletService.postTransaction(client, {
        type: "BET_RESERVED",
        idempotencyKey: `bet:${command.requestId}`,
        referenceType: "wager",
        referenceId: command.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -(amountMinor + feeMinor) },
          { accountId: accounts.room, amountMinor },
          ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: feeMinor }] : []),
        ],
        metadata: { roundId: command.roundId, choice: command.choice, feeMinor },
      });
      await client.query(
        `INSERT INTO wagers (id,request_id,round_id,room_id,user_id,choice,amount_minor,fee_minor)
         VALUES ($1,$1,$2,$3,$4,$5,$6,$7)`,
        [command.requestId, command.roundId, command.roomId, userId, command.choice, amountMinor, feeMinor],
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

  async cancel(userId: string, roomId: string, roundId: string, choice: AutomaticBetChoice): Promise<{ balance: number; cancelledMinor: number }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ phase: string; room_id: string }>(
        "SELECT phase,room_id FROM game_rounds WHERE id=$1 FOR UPDATE",
        [roundId],
      );
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== roomId) throw new Error("BETTING_CLOSED");
      const wagers = await client.query<{ id: string; amount_minor: string; fee_minor: string }>(
        "SELECT id,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND user_id=$2 AND choice=$3 AND status='accepted' FOR UPDATE",
        [roundId, userId, choice],
      );
      if (wagers.rowCount === 0) throw new Error("BET_NOT_FOUND");
      let cancelledMinor = 0;
      for (const wager of wagers.rows) {
        const amountMinor = Number(wager.amount_minor);
        const feeMinor = Number(wager.fee_minor);
        cancelledMinor += amountMinor + feeMinor;
        const accounts = await walletService.accountIds(client, userId, roomId);
        await walletService.postTransaction(client, {
          type: "BET_CANCELLED",
          idempotencyKey: `cancel:${wager.id}`,
          referenceType: "wager",
          referenceId: wager.id,
          entries: [
            { accountId: accounts.room, amountMinor: -amountMinor },
            ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: -feeMinor }] : []),
            { accountId: accounts.user, amountMinor: amountMinor + feeMinor },
          ],
          metadata: { roundId, choice },
        });
        await client.query("UPDATE wagers SET payout_minor=amount_minor,outcome='push',status='cancelled',settled_at=now() WHERE id=$1", [wager.id]);
      }
      await client.query("COMMIT");
      return { balance: await walletService.getUserBalance(userId), cancelledMinor };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recentResults(roomId: string, limit = 60): Promise<RoundHistoryEntry[]> {
    const result = await pool.query<{ result: "player" | "banker" | "tie"; player_pair: boolean; banker_pair: boolean }>(
      "SELECT result, player_pair, banker_pair FROM game_rounds WHERE room_id=$1 AND result IS NOT NULL ORDER BY round_number DESC LIMIT $2",
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => ({ result: row.result, playerPair: row.player_pair, bankerPair: row.banker_pair }));
  }

  async recentDragonTigerResults(roomId: string, limit = 60): Promise<Array<{ result: "dragon" | "tiger" | "tie"; suitedTie: boolean }>> {
    const result = await pool.query<{ result: "dragon" | "tiger" | "tie"; suited_tie: boolean | null }>(
      `SELECT result, (result_data->>'suitedTie')::boolean AS suited_tie
       FROM game_rounds WHERE room_id=$1 AND result IS NOT NULL AND rules_version='dragon-tiger-v1'
       ORDER BY round_number DESC LIMIT $2`,
      [roomId, limit],
    );
    return result.rows.reverse().map((row) => ({ result: row.result, suitedTie: row.suited_tie ?? false }));
  }

  async betsForRound(roundId: string): Promise<Array<{ id: string; userId: string; choice: AutomaticBetChoice; amountMinor: number; feeMinor: number }>> {
    const result = await pool.query<{ id: string; user_id: string; choice: AutomaticBetChoice; amount_minor: string; fee_minor: string }>(
      "SELECT id,user_id,choice,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND status='accepted' ORDER BY placed_at",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, choice: row.choice, amountMinor: Number(row.amount_minor), feeMinor: Number(row.fee_minor) }));
  }

  async settle(roomId: string, roundId: string, result: BaccaratResult): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleBaccarat(roomId, roundId, result);
  }

  async settleBaccarat(
    roomId: string,
    roundId: string,
    result: BaccaratResult,
    lightningCards: LightningCard[] = [],
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, "baccarat_wager", (choice, stake) => {
      if (!["player", "banker", "tie", "player_pair", "banker_pair"].includes(choice)) throw new Error("INVALID_BET_CHOICE");
      const baccaratChoice = choice as BaccaratBetChoice;
      return lightningCards.length > 0
        ? payoutForLightningBaccaratBet(baccaratChoice, result, lightningCards, stake, COIN_SCALE)
        : payoutForBaccaratBet(baccaratChoice, result, stake, COIN_SCALE);
    }, { result: result.result, lightningCards });
  }

  async settleDragonTiger(
    roomId: string,
    roundId: string,
    result: DragonTigerResult,
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    return this.settleResolved(roomId, roundId, "dragon_tiger_wager", (choice, stake) => {
      if (!["dragon", "tiger", "tie", "suited_tie"].includes(choice)) throw new Error("INVALID_BET_CHOICE");
      return payoutForDragonTigerBet(choice as DragonTigerBetChoice, result, stake, COIN_SCALE);
    }, { result: result.result, suitedTie: result.suitedTie });
  }

  private async settleResolved(
    roomId: string,
    roundId: string,
    sourceType: "baccarat_wager" | "dragon_tiger_wager",
    payoutFor: (choice: AutomaticBetChoice, stake: number) => number,
    resultMetadata: Record<string, unknown>,
  ): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    const bets = await this.betsForRound(roundId);
    const balances = new Map<string, number>();
    const wins: AutomaticTableWin[] = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const bet of bets) {
        const accounts = await walletService.accountIds(client, bet.userId, roomId);
        const payoutMinor = payoutFor(bet.choice, bet.amountMinor);
        const outcome = payoutMinor === bet.amountMinor ? "push" : payoutMinor > bet.amountMinor ? "win" : "lose";
        const houseDelta = bet.amountMinor - payoutMinor;
        const entries = [
          { accountId: accounts.room, amountMinor: -bet.amountMinor },
          ...(payoutMinor > 0 ? [{ accountId: accounts.user, amountMinor: payoutMinor }] : []),
          ...(houseDelta !== 0 ? [{ accountId: accounts.house, amountMinor: houseDelta }] : []),
        ];
        await walletService.postTransaction(client, {
          type: "BET_SETTLED",
          idempotencyKey: `settle:${bet.id}`,
          referenceType: "wager",
          referenceId: bet.id,
          entries,
          metadata: { outcome, ...resultMetadata },
        });
        if (outcome !== "push") await wageringService.applyEligibleWager(client, bet.userId, sourceType, bet.id, bet.amountMinor);
        await client.query(
          "UPDATE wagers SET payout_minor=$2,outcome=$3,status='settled',settled_at=now() WHERE id=$1",
          [bet.id, payoutMinor, outcome],
        );
        if (payoutMinor > bet.amountMinor) wins.push({ userId: bet.userId, choice: bet.choice, profitMinor: payoutMinor - bet.amountMinor });
      }
      await client.query("COMMIT");
      for (const userId of new Set(bets.map((bet) => bet.userId))) balances.set(userId, await walletService.getUserBalance(userId));
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
      await client.query("SELECT pg_advisory_xact_lock(hashtext('golden:round-recovery'))");
      const rounds = await client.query<{ id: string; room_id: string }>(
        "SELECT id,room_id FROM game_rounds WHERE settled_at IS NULL AND phase NOT IN ('RESULT','ABORTED') FOR UPDATE",
      );
      for (const round of rounds.rows) {
        await this.refundRoundWithClient(client, round.id, round.room_id, "server_restart");
      }
      await client.query("COMMIT");
      return rounds.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async refundRound(roundId: string, reason: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ room_id: string }>(
        "SELECT room_id FROM game_rounds WHERE id=$1 AND settled_at IS NULL AND phase NOT IN ('RESULT','ABORTED') FOR UPDATE",
        [roundId],
      );
      if (round.rows[0]) await this.refundRoundWithClient(client, roundId, round.rows[0].room_id, reason);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async refundRoundWithClient(client: PoolClient, roundId: string, roomId: string, reason: string): Promise<void> {
    const wagers = await client.query<{ id: string; user_id: string; amount_minor: string; fee_minor: string }>(
      "SELECT id,user_id,amount_minor,fee_minor FROM wagers WHERE round_id=$1 AND status='accepted' FOR UPDATE",
      [roundId],
    );
    for (const wager of wagers.rows) {
      const amountMinor = Number(wager.amount_minor);
      const feeMinor = Number(wager.fee_minor);
      const accounts = await walletService.accountIds(client, wager.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BET_REFUNDED",
        idempotencyKey: `recovery:${wager.id}`,
        referenceType: "wager",
        referenceId: wager.id,
        entries: [
          { accountId: accounts.room, amountMinor: -amountMinor },
          ...(feeMinor > 0 ? [{ accountId: accounts.house, amountMinor: -feeMinor }] : []),
          { accountId: accounts.user, amountMinor: amountMinor + feeMinor },
        ],
        metadata: { reason },
      });
      await client.query(
        "UPDATE wagers SET payout_minor=amount_minor,outcome='push',status='cancelled',settled_at=now() WHERE id=$1",
        [wager.id],
      );
    }
    await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
  }
}

export const baccaratBetService = new BaccaratBetService();
