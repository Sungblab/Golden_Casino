import { COIN_SCALE, type BaccaratBetChoice, type PlaceBetCommand, type RoundHistoryEntry } from "@golden/contracts";
import { payoutMultiplierHundredths, type BaccaratResult } from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import type { PoolClient } from "pg";

export interface BaccaratWin {
  userId: string;
  choice: BaccaratBetChoice;
  payoutMinor: number;
}

export class BaccaratBetService {
  async place(userId: string, command: PlaceBetCommand, minBet: number, maxBet: number): Promise<{ duplicate: boolean; balance: number }> {
    if (command.amount < minBet || command.amount > maxBet) throw new Error("BET_LIMIT");
    const amountMinor = command.amount * COIN_SCALE;
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
           WHERE request_id=$1 AND user_id=$2 AND room_id=$3 AND round_id=$4 AND choice=$5 AND amount_minor=$6`,
          [command.requestId, userId, command.roomId, command.roundId, command.choice, amountMinor],
        );
        if (!matching.rowCount) throw new Error("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { duplicate: true, balance: await walletService.getUserBalance(userId) };
      }
      const accumulated = await client.query<{ total: string }>(
        "SELECT COALESCE(SUM(amount_minor),0) AS total FROM wagers WHERE round_id=$1 AND user_id=$2 AND status='accepted'",
        [command.roundId, userId],
      );
      if (Number(accumulated.rows[0]!.total) + amountMinor > maxBet * COIN_SCALE) throw new Error("BET_LIMIT");
      const accounts = await walletService.accountIds(client, userId, command.roomId);
      await walletService.postTransaction(client, {
        type: "BET_RESERVED",
        idempotencyKey: `bet:${command.requestId}`,
        referenceType: "wager",
        referenceId: command.requestId,
        entries: [
          { accountId: accounts.user, amountMinor: -amountMinor },
          { accountId: accounts.room, amountMinor },
        ],
        metadata: { roundId: command.roundId, choice: command.choice },
      });
      await client.query(
        `INSERT INTO wagers (id,request_id,round_id,room_id,user_id,choice,amount_minor)
         VALUES ($1,$1,$2,$3,$4,$5,$6)`,
        [command.requestId, command.roundId, command.roomId, userId, command.choice, amountMinor],
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

  async cancel(userId: string, roomId: string, roundId: string, choice: BaccaratBetChoice): Promise<{ balance: number; cancelledMinor: number }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const round = await client.query<{ phase: string; room_id: string }>(
        "SELECT phase,room_id FROM game_rounds WHERE id=$1 FOR UPDATE",
        [roundId],
      );
      if (round.rows[0]?.phase !== "BETTING" || round.rows[0]?.room_id !== roomId) throw new Error("BETTING_CLOSED");
      const wagers = await client.query<{ id: string; amount_minor: string }>(
        "SELECT id,amount_minor FROM wagers WHERE round_id=$1 AND user_id=$2 AND choice=$3 AND status='accepted' FOR UPDATE",
        [roundId, userId, choice],
      );
      if (wagers.rowCount === 0) throw new Error("BET_NOT_FOUND");
      let cancelledMinor = 0;
      for (const wager of wagers.rows) {
        const amountMinor = Number(wager.amount_minor);
        cancelledMinor += amountMinor;
        const accounts = await walletService.accountIds(client, userId, roomId);
        await walletService.postTransaction(client, {
          type: "BET_CANCELLED",
          idempotencyKey: `cancel:${wager.id}`,
          referenceType: "wager",
          referenceId: wager.id,
          entries: [
            { accountId: accounts.room, amountMinor: -amountMinor },
            { accountId: accounts.user, amountMinor },
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

  async betsForRound(roundId: string): Promise<Array<{ id: string; userId: string; choice: BaccaratBetChoice; amountMinor: number }>> {
    const result = await pool.query<{ id: string; user_id: string; choice: BaccaratBetChoice; amount_minor: string }>(
      "SELECT id,user_id,choice,amount_minor FROM wagers WHERE round_id=$1 AND status='accepted' ORDER BY placed_at",
      [roundId],
    );
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, choice: row.choice, amountMinor: Number(row.amount_minor) }));
  }

  async settle(roomId: string, roundId: string, result: BaccaratResult): Promise<{ balances: Map<string, number>; wins: BaccaratWin[] }> {
    const bets = await this.betsForRound(roundId);
    const balances = new Map<string, number>();
    const wins: BaccaratWin[] = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const bet of bets) {
        const accounts = await walletService.accountIds(client, bet.userId, roomId);
        const multiplier = payoutMultiplierHundredths(bet.choice, result);
        const payoutMinor = Math.floor((bet.amountMinor * multiplier) / 100);
        const outcome = multiplier === 0 ? "lose" : multiplier === 100 ? "push" : "win";
        const entries = multiplier === 0
          ? [{ accountId: accounts.room, amountMinor: -bet.amountMinor }, { accountId: accounts.house, amountMinor: bet.amountMinor }]
          : [
              { accountId: accounts.room, amountMinor: -bet.amountMinor },
              { accountId: accounts.user, amountMinor: payoutMinor },
              ...(payoutMinor > bet.amountMinor ? [{ accountId: accounts.house, amountMinor: -(payoutMinor - bet.amountMinor) }] : []),
            ];
        await walletService.postTransaction(client, {
          type: "BET_SETTLED",
          idempotencyKey: `settle:${bet.id}`,
          referenceType: "wager",
          referenceId: bet.id,
          entries,
          metadata: { outcome, multiplier },
        });
        await client.query(
          "UPDATE wagers SET payout_minor=$2,outcome=$3,status='settled',settled_at=now() WHERE id=$1",
          [bet.id, payoutMinor, outcome],
        );
        if (payoutMinor > bet.amountMinor) wins.push({ userId: bet.userId, choice: bet.choice, payoutMinor });
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
    const wagers = await client.query<{ id: string; user_id: string; amount_minor: string }>(
      "SELECT id,user_id,amount_minor FROM wagers WHERE round_id=$1 AND status='accepted' FOR UPDATE",
      [roundId],
    );
    for (const wager of wagers.rows) {
      const amountMinor = Number(wager.amount_minor);
      const accounts = await walletService.accountIds(client, wager.user_id, roomId);
      await walletService.postTransaction(client, {
        type: "BET_REFUNDED",
        idempotencyKey: `recovery:${wager.id}`,
        referenceType: "wager",
        referenceId: wager.id,
        entries: [
          { accountId: accounts.room, amountMinor: -amountMinor },
          { accountId: accounts.user, amountMinor },
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
