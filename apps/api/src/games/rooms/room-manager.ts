import type { Server, Socket } from "socket.io";
import {
  COIN_SCALE,
  type BaccaratBetChoice,
  type CancelBetCommand,
  type ClientToServerEvents,
  type GameRoom,
  type GameType,
  type PlaceBetCommand,
  type RoomPhase,
  type RoomSnapshot,
  type RoundHistoryEntry,
  type ServerToClientEvents,
  type WinnerFeedEntry,
} from "@golden/contracts";
import { generateLightningCards, playBaccaratRound, Shoe, type BaccaratResult, type LightningCard } from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { baccaratBetService, type BaccaratWin } from "../baccarat/bet-service.js";
import { buildWinnerEntry, pushWinnerEntries } from "../winner-feed.js";
import type { AuthUser } from "../../auth/auth.js";

const BACCARAT_CHOICE_LABEL: Record<BaccaratBetChoice, string> = {
  player: "PLAYER",
  banker: "BANKER",
  tie: "TIE",
  player_pair: "P PAIR",
  banker_pair: "B PAIR",
};

type GoldenServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;
type GoldenSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;

interface RoomRow {
  id: string;
  game_type: GameType;
  code: string;
  name: string;
  min_bet: number;
  max_bet: number;
  enabled: boolean;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Round timing. Named the same way as blackjack-room-manager.ts so the two tables are
 * read side by side.
 *
 * DEALING_MS is the one value that is not free to pick: the web client reveals the round's
 * cards one at a time (see DEAL_STEP_MS in BaccaratRoomPage.tsx) and a six-card round takes
 * ~2.8s to finish that animation. Anything shorter here and the table settles while the
 * player is still watching cards land, so the result banner flashes past.
 */
const BETTING_MS = 12_000;
const LOCKED_MS = 700;
const DEALING_MS = 3_400;
const SETTLING_MS = 1_000;
const RESULT_MS = 4_000;

class AutomaticBaccaratRoomActor {
  private phase: RoomPhase = "WAITING";
  private roundId: string | null = null;
  private phaseEndsAt: string | null = null;
  private sequence = 0;
  private result: BaccaratResult | null = null;
  private lightningCards: LightningCard[] = [];
  private shoe = new Shoe(6);
  private participants = new Map<string, Set<string>>();
  private usernames = new Map<string, string>();
  private cycleToken = 0;
  private cycleRunning = false;
  private recentResults: RoundHistoryEntry[] = [];
  private recentWinners: WinnerFeedEntry[] = [];
  private paused = false;

  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}

  private get isLightning(): boolean {
    return this.room.game_type === "lightning_baccarat";
  }

  async loadHistory(): Promise<void> {
    // The shoe itself is in memory and is freshly shuffled after a server restart.
    // Loading results from an older shoe would create a false road, so a new process
    // deliberately starts with a clean scoreboard as a physical table would after a shuffle.
    this.recentResults = [];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused && this.phase === "WAITING" && this.playerCount > 0) this.launchCycle();
  }

  get playerCount(): number {
    return this.participants.size;
  }

  publicRoom(): GameRoom {
    return {
      id: this.room.id,
      gameType: this.room.game_type,
      code: this.room.code,
      name: this.room.name,
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      playerCount: this.playerCount,
      phase: this.phase,
      enabled: this.room.enabled,
      paused: this.paused,
      recentResults: this.recentResults,
    };
  }

  async join(socket: GoldenSocket): Promise<RoomSnapshot> {
    const user = socket.data.user;
    const sockets = this.participants.get(user.id) ?? new Set<string>();
    sockets.add(socket.id);
    this.participants.set(user.id, sockets);
    this.usernames.set(user.id, user.nickname);
    await socket.join(this.channel);
    this.emitPresence();
    socket.emit("room.winners", { entries: this.recentWinners });
    if (this.phase === "WAITING") this.launchCycle();
    return this.snapshot(user.id);
  }

  async leave(socket: GoldenSocket): Promise<void> {
    const userId = socket.data.user.id;
    const sockets = this.participants.get(userId);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) this.participants.delete(userId);
    await socket.leave(this.channel);
    this.emitPresence();
  }

  hasSocket(socketId: string): boolean {
    for (const sockets of this.participants.values()) if (sockets.has(socketId)) return true;
    return false;
  }

  hasParticipant(userId: string): boolean {
    return this.participants.has(userId);
  }

  async placeBet(userId: string, command: PlaceBetCommand): Promise<RoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    await baccaratBetService.place(userId, command, this.room.min_bet, this.room.max_bet, this.isLightning ? 20 : 0);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async cancelBet(userId: string, roundId: string, choice: PlaceBetCommand["choice"]): Promise<RoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    await baccaratBetService.cancel(userId, this.room.id, roundId, choice);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async snapshot(userId: string): Promise<RoomSnapshot> {
    const myBets = { player: 0, banker: 0, tie: 0, player_pair: 0, banker_pair: 0 };
    if (this.roundId) {
      const wagers = await pool.query<{ choice: keyof typeof myBets; total: string }>(
        "SELECT choice,SUM(amount_minor) AS total FROM wagers WHERE round_id=$1 AND user_id=$2 AND status='accepted' GROUP BY choice",
        [this.roundId, userId],
      );
      for (const wager of wagers.rows) myBets[wager.choice] = Math.floor(Number(wager.total) / COIN_SCALE);
    }
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      phaseEndsAt: this.phaseEndsAt,
      playerCards: this.result?.playerCards ?? [],
      bankerCards: this.result?.bankerCards ?? [],
      playerScore: this.result?.playerScore ?? null,
      bankerScore: this.result?.bankerScore ?? null,
      result: this.result?.result ?? null,
      playerPair: this.result?.playerPair ?? false,
      bankerPair: this.result?.bankerPair ?? false,
      myBets,
      walletBalance: await walletService.getUserBalance(userId),
      recentResults: this.recentResults,
      shoeRemaining: this.shoe.remaining,
      lightningCards: this.lightningCards,
      lightningFeePercent: this.isLightning ? 20 : 0,
    };
  }

  private get channel(): string {
    return `room:${this.room.id}`;
  }

  private emitPresence(): void {
    this.io.emit("room.presence", { roomId: this.room.id, playerCount: this.playerCount });
  }

  /** Never let a broken feed entry take down round settlement — the ledger has already been written by now. */
  private broadcastWinners(wins: BaccaratWin[]): void {
    try {
      if (wins.length === 0) return;
      const entries = wins.map((win) =>
        buildWinnerEntry({
          roomId: this.room.id,
          game: this.room.game_type,
          username: this.usernames.get(win.userId) ?? "player",
          choiceLabel: BACCARAT_CHOICE_LABEL[win.choice as BaccaratBetChoice],
          amount: win.profitMinor / COIN_SCALE,
        }),
      );
      this.recentWinners = pushWinnerEntries(this.recentWinners, entries);
      this.io.to(this.channel).emit("room.winners", { entries: this.recentWinners });
    } catch (error) {
      console.error(`Room ${this.room.code} failed to broadcast winner feed`, error);
    }
  }

  private async emitSnapshots(): Promise<void> {
    for (const [userId, sockets] of this.participants) {
      const snapshot = await this.snapshot(userId);
      for (const socketId of sockets) this.io.to(socketId).emit("room.snapshot", snapshot);
    }
  }

  private launchCycle(): void {
    if (this.cycleRunning || this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    this.cycleRunning = true;
    void this.startCycle().catch(async (error) => {
      console.error(`Room ${this.room.code} cycle failed`, error);
      if (this.roundId) {
        try {
          await baccaratBetService.refundRound(this.roundId, "round_processing_failed");
        } catch (refundError) {
          console.error(`Room ${this.room.code} refund failed`, refundError);
        }
      }
      this.phase = "WAITING";
      this.phaseEndsAt = null;
      this.roundId = null;
      this.result = null;
      this.lightningCards = [];
      this.sequence += 1;
      await this.emitSnapshots();
      for (const sockets of this.participants.values()) {
        for (const socketId of sockets) this.io.to(socketId).emit("notification", { type: "error", message: "라운드가 중단되어 접수된 베팅을 환불했습니다." });
      }
    }).finally(() => {
      this.cycleRunning = false;
      if (this.phase === "WAITING" && this.playerCount > 0) this.launchCycle();
    });
  }

  private async settleWithRetry(result: BaccaratResult): Promise<{ balances: Map<string, number>; wins: BaccaratWin[] }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await baccaratBetService.settleBaccarat(this.room.id, this.roundId!, result, this.lightningCards);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 500);
      }
    }
    throw lastError;
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE game_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
  }

  private async startCycle(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    const token = ++this.cycleToken;
    this.result = null;
    this.lightningCards = [];
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase) VALUES ($1,$2,'BETTING') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    await this.setPhase("BETTING", BETTING_MS);
    await delay(BETTING_MS);
    if (token !== this.cycleToken) return;

    // Persist LOCKED before dealing so late bets observe the closed DB phase.
    await this.setPhase("LOCKED", LOCKED_MS);
    // A participant keeps the table alive even when they skip this round.
    // We still deal and publish a result; settlement simply has no ledger work
    // when the round contains no wagers.
    await delay(LOCKED_MS);
    if (this.isLightning) this.lightningCards = generateLightningCards();
    await this.setPhase("DEALING", DEALING_MS);
    // Road maps represent the active shoe, which is how a live baccarat table
    // presents statistics. A fresh six-deck shoe starts with a fresh road.
    if (this.shoe.remaining < 60) {
      this.shoe = new Shoe(6);
      this.recentResults = [];
    }
    this.result = playBaccaratRound(this.shoe);
    this.recentResults = [
      ...this.recentResults,
      { result: this.result.result, playerPair: this.result.playerPair, bankerPair: this.result.bankerPair },
    ].slice(-60);
    await pool.query(
      `UPDATE game_rounds SET result=$2,player_cards=$3,banker_cards=$4,player_score=$5,banker_score=$6,
       player_pair=$7,banker_pair=$8,result_data=$9 WHERE id=$1`,
      [this.roundId, this.result.result, JSON.stringify(this.result.playerCards), JSON.stringify(this.result.bankerCards), this.result.playerScore, this.result.bankerScore, this.result.playerPair, this.result.bankerPair, JSON.stringify({ lightningCards: this.lightningCards })],
    );
    // The DEALING snapshot already went out with empty hands; this is a distinct state
    // (cards now dealt) and must carry a newer sequence or clients that dedupe by
    // "sequence >= current" can keep the empty-hand snapshot and never see the cards.
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(DEALING_MS);
    await this.setPhase("SETTLING", SETTLING_MS);
    const { balances, wins } = await this.settleWithRetry(this.result);
    for (const [userId, balance] of balances) {
      for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("wallet.updated", { balance });
    }
    this.broadcastWinners(wins);
    await pool.query("UPDATE game_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [this.roundId]);
    await this.setPhase("RESULT", RESULT_MS);
    await delay(RESULT_MS);
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.roundId = null;
    this.result = null;
    this.lightningCards = [];
    this.sequence += 1;
    await this.emitSnapshots();
    if (this.playerCount > 0) this.launchCycle();
  }
}

export class RoomManager {
  private actors = new Map<string, AutomaticBaccaratRoomActor>();

  constructor(private readonly io: GoldenServer) {}

  async initialize(): Promise<void> {
    const recovered = await baccaratBetService.recoverInterruptedRounds();
    if (recovered > 0) console.warn(`Recovered ${recovered} interrupted baccarat rounds`);
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,enabled FROM game_rooms ORDER BY min_bet");
    for (const row of result.rows) {
      if (row.game_type !== "baccarat" && row.game_type !== "lightning_baccarat") continue;
      const actor = new AutomaticBaccaratRoomActor(this.io, row);
      await actor.loadHistory();
      this.actors.set(row.id, actor);
    }
  }

  listRooms(): GameRoom[] {
    return [...this.actors.values()].map((actor) => actor.publicRoom());
  }

  async join(socket: GoldenSocket, roomId: string): Promise<RoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor?.room.enabled) throw new Error("ROOM_NOT_FOUND");
    return actor.join(socket);
  }

  async leave(socket: GoldenSocket, roomId: string): Promise<void> {
    await this.actors.get(roomId)?.leave(socket);
  }

  async disconnect(socket: GoldenSocket): Promise<void> {
    for (const actor of this.actors.values()) if (actor.hasSocket(socket.id)) await actor.leave(socket);
  }

  async placeBet(userId: string, command: PlaceBetCommand): Promise<RoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.placeBet(userId, command);
  }

  async cancelBet(userId: string, command: CancelBetCommand): Promise<RoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.cancelBet(userId, command.roundId, command.choice);
  }

  isParticipant(userId: string, roomId: string): boolean {
    return this.actors.get(roomId)?.hasParticipant(userId) ?? false;
  }

  setPaused(roomId: string, paused: boolean): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.setPaused(paused);
    return true;
  }
}
