import type { Server, Socket } from "socket.io";
import {
  COIN_SCALE,
  type BetZoneTotal,
  type ClientToServerEvents,
  type DragonTigerBetChoice,
  type DragonTigerBetCommand,
  type DragonTigerCancelCommand,
  type DragonTigerHistoryEntry,
  type DragonTigerRoomSnapshot,
  type GameRoom,
  type GameType,
  type RoomPhase,
  type ServerToClientEvents,
  type WinnerFeedEntry,
} from "@golden/contracts";
import { playDragonTigerRound, Shoe, type DragonTigerResult } from "@golden/game-core";
import type { AuthUser } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { baccaratBetService, type AutomaticTableWin } from "../baccarat/bet-service.js";
import { buildWinnerEntry, pushWinnerEntries } from "../winner-feed.js";

type GoldenServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;
type GoldenSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;

interface RoomRow {
  id: string;
  game_type: GameType;
  code: string;
  name: string;
  min_bet: number;
  max_bet: number;
  side_bet_max: number | null;
  enabled: boolean;
}

const CHOICE_LABEL: Record<DragonTigerBetChoice, string> = {
  dragon: "DRAGON",
  tiger: "TIGER",
  tie: "TIE",
  suited_tie: "SUITED TIE",
};

const BETTING_MS = 12_000;
const LOCKED_MS = 700;
const DEALING_MS = 1_800;
const SETTLING_MS = 900;
const RESULT_MS = 4_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class DragonTigerRoomActor {
  private phase: RoomPhase = "WAITING";
  private roundId: string | null = null;
  private phaseEndsAt: string | null = null;
  private sequence = 0;
  private result: DragonTigerResult | null = null;
  private shoe = new Shoe(8);
  private participants = new Map<string, Set<string>>();
  private usernames = new Map<string, string>();
  private recentWinners: WinnerFeedEntry[] = [];
  private recentResults: DragonTigerHistoryEntry[] = [];
  private cycleRunning = false;
  private cycleToken = 0;
  private paused = false;

  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}

  get playerCount(): number {
    return this.participants.size;
  }

  private get channel(): string {
    return `dt-room:${this.room.id}`;
  }

  async loadHistory(): Promise<void> {
    this.recentResults = await baccaratBetService.recentDragonTigerResults(this.room.id);
  }

  publicRoom(): GameRoom {
    return {
      id: this.room.id,
      gameType: this.room.game_type,
      code: this.room.code,
      name: this.room.name,
      minBet: this.room.min_bet,
      maxBet: this.room.max_bet,
      sideBetMax: this.room.side_bet_max,
      playerCount: this.playerCount,
      phase: this.phase,
      enabled: this.room.enabled,
      paused: this.paused,
      // The lobby card's compact road preview reuses Baccarat's road shape — map dragon/tiger
      // onto player/banker and suitedTie onto the pair-dot slot purely for that visual reuse.
      recentResults: this.recentResults.map((entry) => ({
        result: entry.result === "dragon" ? "player" : entry.result === "tiger" ? "banker" : "tie",
        playerPair: false,
        bankerPair: entry.suitedTie,
      })),
    };
  }

  /** Admin "clear the scoreboard" — wipes the visible road now, and durably (see resetRoad in
   * bet-service.ts) so it stays clear across a restart too, without touching round/wager history. */
  async resetRoad(): Promise<void> {
    await baccaratBetService.resetRoad(this.room.id);
    this.recentResults = [];
    this.sequence += 1;
    await this.emitSnapshots();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused && this.phase === "WAITING" && this.playerCount > 0) this.launchCycle();
  }

  hasSocket(socketId: string): boolean {
    for (const sockets of this.participants.values()) if (sockets.has(socketId)) return true;
    return false;
  }

  hasParticipant(userId: string): boolean {
    return this.participants.has(userId);
  }

  participantUserIds(): string[] {
    return [...this.participants.keys()];
  }

  async join(socket: GoldenSocket): Promise<DragonTigerRoomSnapshot> {
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
    const sockets = this.participants.get(socket.data.user.id);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) this.participants.delete(socket.data.user.id);
    await socket.leave(this.channel);
    this.emitPresence();
  }

  async placeBet(userId: string, command: DragonTigerBetCommand): Promise<DragonTigerRoomSnapshot> {
    if (!this.hasParticipant(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    await baccaratBetService.place(userId, command, this.room.min_bet, this.room.max_bet, 0, this.room.side_bet_max);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async cancelBet(userId: string, command: DragonTigerCancelCommand): Promise<DragonTigerRoomSnapshot> {
    if (!this.hasParticipant(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    await baccaratBetService.cancel(userId, this.room.id, command.roundId, command.choice);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async snapshot(userId: string, betTotals?: Record<string, BetZoneTotal>): Promise<DragonTigerRoomSnapshot> {
    const myBets: Record<DragonTigerBetChoice, number> = { dragon: 0, tiger: 0, tie: 0, suited_tie: 0 };
    if (this.roundId) {
      const wagers = await pool.query<{ choice: DragonTigerBetChoice; total: string }>(
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
      dragonCard: this.result?.dragonCard ?? null,
      tigerCard: this.result?.tigerCard ?? null,
      result: this.result?.result ?? null,
      suitedTie: this.result?.suitedTie ?? false,
      myBets,
      betTotals: betTotals ?? (this.roundId ? await baccaratBetService.roundBetTotals(this.roundId) : {}),
      walletBalance: await walletService.getUserBalance(userId),
      shoeRemaining: this.shoe.remaining,
      recentResults: this.recentResults,
    };
  }

  private emitPresence(): void {
    this.io.emit("room.presence", { roomId: this.room.id, playerCount: this.playerCount });
  }

  private async emitSnapshots(): Promise<void> {
    const betTotals = this.roundId ? await baccaratBetService.roundBetTotals(this.roundId) : {};
    for (const [userId, sockets] of this.participants) {
      const snapshot = await this.snapshot(userId, betTotals);
      for (const socketId of sockets) this.io.to(socketId).emit("dragonTiger.snapshot", snapshot);
    }
  }

  private broadcastWinners(wins: AutomaticTableWin[]): void {
    const entries = wins.map((win) => buildWinnerEntry({
      roomId: this.room.id,
      game: "dragon_tiger",
      username: this.usernames.get(win.userId) ?? "player",
      choiceLabel: CHOICE_LABEL[win.choice as DragonTigerBetChoice],
      amount: win.profitMinor / COIN_SCALE,
    }));
    this.recentWinners = pushWinnerEntries(this.recentWinners, entries);
    this.io.to(this.channel).emit("room.winners", { entries: this.recentWinners });
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE game_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
  }

  private launchCycle(): void {
    if (this.cycleRunning || this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    this.cycleRunning = true;
    void this.startCycle().catch(async (error) => {
      console.error(`Dragon Tiger room ${this.room.code} cycle failed`, error);
      if (this.roundId) await baccaratBetService.refundRound(this.roundId, "round_processing_failed").catch(console.error);
      this.phase = "WAITING";
      this.phaseEndsAt = null;
      this.roundId = null;
      this.result = null;
      this.sequence += 1;
      await this.emitSnapshots();
    }).finally(() => {
      this.cycleRunning = false;
      if (this.phase === "WAITING" && this.playerCount > 0) this.launchCycle();
    });
  }

  private async settleWithRetry(): Promise<{ balances: Map<string, number>; wins: AutomaticTableWin[] }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await baccaratBetService.settleDragonTiger(this.room.id, this.roundId!, this.result!);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 500);
      }
    }
    throw lastError;
  }

  private async startCycle(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    const token = ++this.cycleToken;
    this.result = null;
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'BETTING','dragon-tiger-v1') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    await this.setPhase("BETTING", BETTING_MS);
    await delay(BETTING_MS);
    if (token !== this.cycleToken) return;
    await this.setPhase("LOCKED", LOCKED_MS);
    await delay(LOCKED_MS);
    await this.setPhase("DEALING", DEALING_MS);
    // The road map represents the active shoe, same convention as Baccarat: a fresh shoe starts a fresh road.
    if (this.shoe.remaining < 52) {
      this.shoe = new Shoe(8);
      this.recentResults = [];
    }
    this.result = playDragonTigerRound(this.shoe);
    await pool.query(
      "UPDATE game_rounds SET result=$2,player_cards=$3,banker_cards=$4,result_data=$5 WHERE id=$1",
      [this.roundId, this.result.result, JSON.stringify([this.result.dragonCard]), JSON.stringify([this.result.tigerCard]), JSON.stringify({ suitedTie: this.result.suitedTie })],
    );
    this.recentResults = [...this.recentResults, { result: this.result.result, suitedTie: this.result.suitedTie }].slice(-60);
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(DEALING_MS);
    await this.setPhase("SETTLING", SETTLING_MS);
    const { balances, wins } = await this.settleWithRetry();
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
    this.sequence += 1;
    await this.emitSnapshots();
    if (this.playerCount > 0) this.launchCycle();
  }
}

export class DragonTigerRoomManager {
  private actors = new Map<string, DragonTigerRoomActor>();

  constructor(private readonly io: GoldenServer) {}

  async initialize(): Promise<void> {
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,side_bet_max,enabled FROM game_rooms WHERE game_type='dragon_tiger' ORDER BY min_bet");
    for (const row of result.rows) {
      const actor = new DragonTigerRoomActor(this.io, row);
      await actor.loadHistory();
      this.actors.set(row.id, actor);
    }
  }

  listRooms(): GameRoom[] { return [...this.actors.values()].map((actor) => actor.publicRoom()); }
  isParticipant(userId: string, roomId: string): boolean { return this.actors.get(roomId)?.hasParticipant(userId) ?? false; }
  participantUserIds(roomId: string): string[] | null { return this.actors.get(roomId)?.participantUserIds() ?? null; }
  setPaused(roomId: string, paused: boolean): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.setPaused(paused);
    return true;
  }
  async resetRoad(roomId: string): Promise<boolean> {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    await actor.resetRoad();
    return true;
  }
  async join(socket: GoldenSocket, roomId: string): Promise<DragonTigerRoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor?.room.enabled) throw new Error("ROOM_NOT_FOUND");
    return actor.join(socket);
  }
  async leave(socket: GoldenSocket, roomId: string): Promise<void> { await this.actors.get(roomId)?.leave(socket); }
  async disconnect(socket: GoldenSocket): Promise<void> {
    for (const actor of this.actors.values()) if (actor.hasSocket(socket.id)) await actor.leave(socket);
  }
  async placeBet(userId: string, command: DragonTigerBetCommand): Promise<DragonTigerRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.placeBet(userId, command);
  }
  async cancelBet(userId: string, command: DragonTigerCancelCommand): Promise<DragonTigerRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.cancelBet(userId, command);
  }
}
