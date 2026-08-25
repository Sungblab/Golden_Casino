import type { PoolClient } from "pg";
import { COIN_SCALE } from "@golden/contracts";
import { pool } from "../database/pool.js";

export type WageringSourceType = "baccarat_wager" | "dragon_tiger_wager" | "blackjack_hand" | "blackjack_behind" | "blackjack_insurance" | "holdem_rake" | "casino_holdem_wager" | "sutda_rake";

export type WageringProgressMinor = {
  requiredMinor: number;
  completedMinor: number;
  remainingMinor: number;
};

export type WageringProgress = {
  required: number;
  completed: number;
  remaining: number;
  progressPercent: number;
  canWithdraw: boolean;
};

export class WageringRequirementError extends Error {
  constructor(public readonly remainingMinor: number) {
    super("WAGERING_REQUIREMENT");
  }
}

export function progressAfterDeposit(current: WageringProgressMinor, amountMinor: number): WageringProgressMinor {
  if (amountMinor <= 0) throw new Error("WAGERING_AMOUNT_INVALID");
  if (current.remainingMinor === 0) return { requiredMinor: amountMinor, completedMinor: 0, remainingMinor: amountMinor };
  return {
    requiredMinor: current.requiredMinor + amountMinor,
    completedMinor: current.completedMinor,
    remainingMinor: current.remainingMinor + amountMinor,
  };
}

export function progressAfterWager(current: WageringProgressMinor, amountMinor: number): WageringProgressMinor {
  if (amountMinor <= 0) throw new Error("WAGERING_AMOUNT_INVALID");
  const creditedMinor = Math.min(current.remainingMinor, amountMinor);
  return {
    requiredMinor: current.requiredMinor,
    completedMinor: current.completedMinor + creditedMinor,
    remainingMinor: current.remainingMinor - creditedMinor,
  };
}

function rowToMinor(row?: { cycle_required_minor: string; cycle_completed_minor: string; remaining_minor: string }): WageringProgressMinor {
  return {
    requiredMinor: Number(row?.cycle_required_minor ?? 0),
    completedMinor: Number(row?.cycle_completed_minor ?? 0),
    remainingMinor: Number(row?.remaining_minor ?? 0),
  };
}

export class WageringService {
  async getProgress(userId: string): Promise<WageringProgress> {
    const result = await pool.query<{ cycle_required_minor: string; cycle_completed_minor: string; remaining_minor: string }>(
      "SELECT cycle_required_minor,cycle_completed_minor,remaining_minor FROM wagering_requirements WHERE user_id=$1",
      [userId],
    );
    const progress = rowToMinor(result.rows[0]);
    const required = Math.round(progress.requiredMinor / COIN_SCALE);
    const completed = Math.round(progress.completedMinor / COIN_SCALE);
    const remaining = Math.round(progress.remainingMinor / COIN_SCALE);
    return {
      required,
      completed,
      remaining,
      progressPercent: required === 0 ? 100 : Math.min(100, Math.floor((completed / required) * 100)),
      canWithdraw: remaining === 0,
    };
  }

  async addDeposit(client: PoolClient, userId: string, cashRequestId: string, amountMinor: number): Promise<void> {
    await this.lockUser(client, userId);
    const event = await client.query<{ id: string }>(
      `INSERT INTO wagering_progress_events (user_id,source_type,source_id,qualifying_amount_minor,credited_amount_minor)
       VALUES ($1,'cash_deposit',$2,$3,0)
       ON CONFLICT (source_type,source_id) DO NOTHING RETURNING id`,
      [userId, cashRequestId, amountMinor],
    );
    if (!event.rows[0]) return;

    const current = await this.getProgressForUpdate(client, userId);
    const next = progressAfterDeposit(current, amountMinor);
    await this.saveProgress(client, userId, next);
  }

  async applyEligibleWager(client: PoolClient, userId: string, sourceType: WageringSourceType, sourceId: string, amountMinor: number): Promise<void> {
    await this.lockUser(client, userId);
    const event = await client.query<{ id: string }>(
      `INSERT INTO wagering_progress_events (user_id,source_type,source_id,qualifying_amount_minor,credited_amount_minor)
       VALUES ($1,$2,$3,$4,0)
       ON CONFLICT (source_type,source_id) DO NOTHING RETURNING id`,
      [userId, sourceType, sourceId, amountMinor],
    );
    if (!event.rows[0]) return;

    const current = await this.getProgressForUpdate(client, userId);
    const next = progressAfterWager(current, amountMinor);
    const creditedMinor = next.completedMinor - current.completedMinor;
    if (creditedMinor > 0) await this.saveProgress(client, userId, next);
    await client.query("UPDATE wagering_progress_events SET credited_amount_minor=$2 WHERE id=$1", [event.rows[0].id, creditedMinor]);
  }

  async assertWithdrawAllowed(client: PoolClient, userId: string): Promise<void> {
    await this.lockUser(client, userId);
    const current = await this.getProgressForUpdate(client, userId);
    if (current.remainingMinor > 0) throw new WageringRequirementError(current.remainingMinor);
  }

  private async lockUser(client: PoolClient, userId: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`wagering:${userId}`]);
  }

  private async getProgressForUpdate(client: PoolClient, userId: string): Promise<WageringProgressMinor> {
    const result = await client.query<{ cycle_required_minor: string; cycle_completed_minor: string; remaining_minor: string }>(
      "SELECT cycle_required_minor,cycle_completed_minor,remaining_minor FROM wagering_requirements WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    return rowToMinor(result.rows[0]);
  }

  private async saveProgress(client: PoolClient, userId: string, progress: WageringProgressMinor): Promise<void> {
    await client.query(
      `INSERT INTO wagering_requirements (user_id,cycle_required_minor,cycle_completed_minor,remaining_minor,updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (user_id) DO UPDATE SET
         cycle_required_minor=EXCLUDED.cycle_required_minor,
         cycle_completed_minor=EXCLUDED.cycle_completed_minor,
         remaining_minor=EXCLUDED.remaining_minor,
         updated_at=now()`,
      [userId, progress.requiredMinor, progress.completedMinor, progress.remainingMinor],
    );
  }
}

export const wageringService = new WageringService();
