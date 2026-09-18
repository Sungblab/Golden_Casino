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
  /**
   * 판을 마무리한다. 누가 얼마를 가져가는지(사이드팟 포함)와 땡값이 누구에게서 누구로 가는지는
   * 방 액터가 game-core 의 규칙으로 미리 계산해 `plan` 으로 넘긴다 — 여기서는 원장만 친다.
   *
   * 땡값은 팟에서 떼는 게 아니라 진 사람 지갑에서 이긴 사람 지갑으로 따로 건너간다. 실제로
   * 판이 끝난 뒤 따로 건네주는 돈이고, 팟에 섞으면 사이드팟 계산이 망가지기 때문이다. 그래서
   * 한 트랜잭션 안의 엔트리 합은 여전히 0이다: (방 −팟) + (하우스 +딜러비) + Σ승자 + Σ(땡값 −/+).
   */
  async settle(
    roomId: string,
    roundId: string,
    plan: {
      rakeMinor: number;
      /** 방 예치금에서 나가는 몫. 사이드팟까지 합산된 사용자별 총액. */
      potPayouts: Map<string, number>;
      /** 지갑 대 지갑으로 건너가는 땡값. */
      ddaeng: Array<{ fromUserId: string; toUserId: string; amountMinor: number }>;
      outcomes: Map<string, "win" | "lose" | "push">;
    },
  ): Promise<{ balances: Map<string, number>; payouts: Map<string, number>; ddaengByUser: Map<string, number> }> {
    const contributions = await this.contributions(roundId);
    const total = contributions.reduce((sum, item) => sum + item.amountMinor, 0);
    const rake = plan.rakeMinor;
    const payouts = plan.potPayouts;
    const ddaengByUser = new Map<string, number>();
    for (const move of plan.ddaeng) {
      ddaengByUser.set(move.fromUserId, (ddaengByUser.get(move.fromUserId) ?? 0) - move.amountMinor);
      ddaengByUser.set(move.toUserId, (ddaengByUser.get(move.toUserId) ?? 0) + move.amountMinor);
    }
    const touched = [...new Set([...contributions.map((item) => item.userId), ...payouts.keys(), ...ddaengByUser.keys()])];
    const client = await pool.connect();
    const balances = new Map<string, number>();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; kind: string; user_id: string | null }>("SELECT id,kind,user_id FROM wallet_accounts WHERE (kind='room' AND room_id=$1) OR kind='house' OR (kind='user' AND user_id=ANY($2::uuid[]))", [roomId, touched]);
      const room = rows.rows.find((row) => row.kind === "room")?.id; const house = rows.rows.find((row) => row.kind === "house")?.id;
      const users = new Map(rows.rows.filter((row) => row.kind === "user").map((row) => [row.user_id!, row.id]));
      if (!room || !house || touched.some((id) => !users.has(id))) throw new Error("Wallet account configuration is incomplete");
      const entries = [
        { accountId: room, amountMinor: -total },
        ...(rake ? [{ accountId: house, amountMinor: rake }] : []),
        ...[...payouts.entries()].filter(([, amount]) => amount !== 0).map(([id, amount]) => ({ accountId: users.get(id)!, amountMinor: amount })),
        ...[...ddaengByUser.entries()].filter(([, amount]) => amount !== 0).map(([id, amount]) => ({ accountId: users.get(id)!, amountMinor: amount })),
      ];
      await walletService.postTransaction(client, { type: "SUTDA_SETTLED", idempotencyKey: `sutda-settle:${roundId}`, referenceType: "sutda_round", referenceId: roundId, entries, metadata: { rakeMinor: rake, ddaengMinor: plan.ddaeng.reduce((sum, move) => sum + move.amountMinor, 0) } });
      for (const item of contributions) {
        const payout = payouts.get(item.userId) ?? 0;
        const outcome = plan.outcomes.get(item.userId) ?? (payout === item.amountMinor ? "push" : "lose");
        await client.query("UPDATE sutda_contributions SET payout_minor=$2,outcome=$3,settled_at=now() WHERE id=$1", [item.id, payout, outcome]);
        // Wagering credit is capped to this contribution's share of rake, not its full stake —
        // crediting the whole stake would let two colluding accounts launder deposits by playing
        // each other (mirrors holdem-service's identical guard).
        if (rake > 0 && total > 0) {
          const rakeShare = Math.floor((rake * item.amountMinor) / total);
          if (rakeShare > 0) await wageringService.applyEligibleWager(client, item.userId, "sutda_rake", item.id, rakeShare);
        }
      }
      await client.query("COMMIT");
      for (const id of touched) balances.set(id, await walletService.getUserBalance(id));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { balances, payouts, ddaengByUser };
  }
  /** 방 액터가 쓰는 딜러비 계산 — 홀덤과 같은 5%·상한 규칙. */
  rakeFor(totalMinor: number, maxBet: number): number { return rakeFor(totalMinor, maxBet * COIN_SCALE); }
  /**
   * 중단된 판의 돈을 되돌린다. **이미 정산된 기여는 건드리지 않는다** — 예전에는 이 판의
   * 모든 기여를 무조건 환불해서, 정산은 끝났는데 game_rounds 에 settled_at 을 찍기 전에
   * 프로세스가 죽은 경우(그 사이는 한 쿼리 폭이다) 부팅 때 이미 나간 돈을 방 예치금에서
   * 또 빼려 들었다. 방 계정에 그만한 잔액이 없으니 INSUFFICIENT_BALANCE 가 터지고,
   * 그 예외가 initialize() 를 타고 올라가 서버가 아예 못 뜬다.
   */
  async refundRound(roundId: string, roomId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<{ id: string; user_id: string; amount_minor: string }>(
        "SELECT id,user_id,amount_minor FROM sutda_contributions WHERE round_id=$1 AND settled_at IS NULL AND amount_minor > 0 FOR UPDATE",
        [roundId],
      );
      for (const row of rows.rows) {
        const amountMinor = Number(row.amount_minor);
        const accounts = await walletService.accountIds(client, row.user_id, roomId);
        await walletService.postTransaction(client, {
          type: "SUTDA_REFUNDED", idempotencyKey: `sutda-refund:${roundId}:${row.user_id}`, referenceType: "sutda_round", referenceId: roundId,
          entries: [{ accountId: accounts.room, amountMinor: -amountMinor }, { accountId: accounts.user, amountMinor }],
          metadata: { reason: "round_processing_failed" },
        });
        await client.query("UPDATE sutda_contributions SET payout_minor=amount_minor,outcome='push',settled_at=now() WHERE id=$1", [row.id]);
      }
      await client.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [roundId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  /**
   * 부팅 스윕. 한 판이 되돌려지지 않는다고 서버 전체가 못 뜨면 안 된다 — 판별로 가두고,
   * 실패한 판은 로그를 남긴 뒤 ABORTED 로 닫아 one_active_round_per_room 이 그 방의 다음
   * 판까지 영원히 막는 일을 피한다.
   */
  async recoverInterruptedRounds(): Promise<number> {
    const rounds = await pool.query<{ id: string; room_id: string }>("SELECT id,room_id FROM game_rounds WHERE settled_at IS NULL AND rules_version='sutda-v1'");
    let handled = 0;
    for (const round of rounds.rows) {
      try { await this.refundRound(round.id, round.room_id); handled += 1; }
      catch (error) {
        console.error(`Sutda round ${round.id} could not be refunded on startup; closing it as ABORTED`, error);
        await pool.query("UPDATE game_rounds SET phase='ABORTED',settled_at=now() WHERE id=$1", [round.id]).catch((closeError) => console.error(`Sutda round ${round.id} could not be closed either`, closeError));
      }
    }
    return handled;
  }
}
export const sutdaService = new SutdaService();
