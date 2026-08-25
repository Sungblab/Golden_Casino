import type { PoolClient } from "pg";
import { COIN_SCALE, type HwatuCard } from "@golden/contracts";
import { rakeFor } from "../holdem/holdem-service.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { wageringService } from "../../wallet/wagering-service.js";

export interface SutdaContribution { id: string; userId: string; seatNumber: number; amountMinor: number; folded: boolean; cards: HwatuCard[] }

export class SutdaService {
  async contribute(client: PoolClient, input: { requestId: string; userId: string; roomId: string; roundId: string; seatNumber: number; amountMinor: number }): Promise<void> {
    const accounts = await walletService.accountIds(client, input.userId, input.roomId);
    const posted = await walletService.postTransaction(client, {
      type: "SUTDA_CONTRIBUTE", idempotencyKey: `sutda-contribute:${input.requestId}`, referenceType: "sutda_round", referenceId: input.roundId,
      entries: [{ accountId: accounts.user, amountMinor: -input.amountMinor }, { accountId: accounts.room, amountMinor: input.amountMinor }], metadata: { seatNumber: input.seatNumber },
    });
    if (!posted.duplicate) await client.query(
      `INSERT INTO sutda_contributions (round_id,room_id,user_id,seat_number,amount_minor) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (round_id,user_id) DO UPDATE SET amount_minor=sutda_contributions.amount_minor+EXCLUDED.amount_minor`,
      [input.roundId, input.roomId, input.userId, input.seatNumber, input.amountMinor],
    );
  }
  async recordCards(roundId: string, userId: string, cards: HwatuCard[]): Promise<void> { await pool.query("UPDATE sutda_contributions SET cards=$3 WHERE round_id=$1 AND user_id=$2", [roundId, userId, JSON.stringify(cards)]); }
  async markFolded(roundId: string, userId: string): Promise<void> { await pool.query("UPDATE sutda_contributions SET folded=true WHERE round_id=$1 AND user_id=$2", [roundId, userId]); }
  async contributions(roundId: string): Promise<SutdaContribution[]> {
    const result = await pool.query<{ id: string; user_id: string; seat_number: number; amount_minor: string; folded: boolean; cards: HwatuCard[] }>("SELECT id,user_id,seat_number,amount_minor,folded,cards FROM sutda_contributions WHERE round_id=$1", [roundId]);
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, seatNumber: row.seat_number, amountMinor: Number(row.amount_minor), folded: row.folded, cards: row.cards }));
  }
  async settle(roomId: string, roundId: string, winnerIds: string[], maxBet: number, takeRake = true): Promise<{ balances: Map<string, number>; payouts: Map<string, number> }> {
    const contributions = await this.contributions(roundId);
    const total = contributions.reduce((sum, item) => sum + item.amountMinor, 0);
    const rake = takeRake ? rakeFor(total, maxBet * COIN_SCALE) : 0;
    const share = Math.floor((total - rake) / winnerIds.length);
    const remainder = total - rake - share * winnerIds.length;
    const payouts = new Map(winnerIds.map((id, index) => [id, share + (index === 0 ? remainder : 0)]));
    const client = await pool.connect();
    const balances = new Map<string, number>();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; kind: string; user_id: string | null }>("SELECT id,kind,user_id FROM wallet_accounts WHERE (kind='room' AND room_id=$1) OR kind='house' OR (kind='user' AND user_id=ANY($2::uuid[]))", [roomId, winnerIds]);
      const room = rows.rows.find((row) => row.kind === "room")?.id; const house = rows.rows.find((row) => row.kind === "house")?.id;
      const users = new Map(rows.rows.filter((row) => row.kind === "user").map((row) => [row.user_id!, row.id]));
      if (!room || !house || winnerIds.some((id) => !users.has(id))) throw new Error("Wallet account configuration is incomplete");
      await walletService.postTransaction(client, { type: "SUTDA_SETTLED", idempotencyKey: `sutda-settle:${roundId}`, referenceType: "sutda_round", referenceId: roundId,
        entries: [{ accountId: room, amountMinor: -total }, ...(rake ? [{ accountId: house, amountMinor: rake }] : []), ...winnerIds.map((id) => ({ accountId: users.get(id)!, amountMinor: payouts.get(id)! }))], metadata: { rakeMinor: rake }, });
      for (const item of contributions) {
        const payout = payouts.get(item.userId) ?? 0;
        await client.query("UPDATE sutda_contributions SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [item.id, payout, payout === item.amountMinor ? "push" : payout > item.amountMinor ? "win" : "lose"]);
        // Wagering credit is capped to this contribution's share of rake, not its full stake —
        // crediting the whole stake would let two colluding accounts launder deposits by playing
        // each other (mirrors holdem-service's identical guard).
        if (rake > 0 && total > 0) {
          const rakeShare = Math.floor((rake * item.amountMinor) / total);
          if (rakeShare > 0) await wageringService.applyEligibleWager(client, item.userId, "sutda_rake", item.id, rakeShare);
        }
      }
      await client.query("COMMIT");
      for (const item of contributions) balances.set(item.userId, await walletService.getUserBalance(item.userId));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { balances, payouts };
  }
  async refundRound(roundId: string, roomId: string): Promise<void> {
    const contributions = await this.contributions(roundId); const client = await pool.connect();
    try { await client.query("BEGIN"); for (const item of contributions) { const accounts = await walletService.accountIds(client, item.userId, roomId); await walletService.postTransaction(client, { type: "SUTDA_REFUNDED", idempotencyKey: `sutda-refund:${roundId}:${item.userId}`, referenceType: "sutda_round", referenceId: roundId, entries: [{ accountId: accounts.room, amountMinor: -item.amountMinor }, { accountId: accounts.user, amountMinor: item.amountMinor }], metadata: { reason: "round_processing_failed" } }); await client.query("UPDATE sutda_contributions SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE id=$1", [item.id]); } await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async recoverInterruptedRounds(): Promise<number> {
    const rounds = await pool.query<{ id: string; room_id: string }>("SELECT id,room_id FROM game_rounds WHERE settled_at IS NULL AND rules_version='sutda-v1'");
    for (const round of rounds.rows) await this.refundRound(round.id, round.room_id);
    return rounds.rowCount ?? 0;
  }
}
export const sutdaService = new SutdaService();
