import type { Server, Socket } from "socket.io";
import {
  COIN_SCALE,
  type Card,
  type CasinoHoldemBetCommand,
  type CasinoHoldemDecideCommand,
  type CasinoHoldemHandSnapshot,
  type CasinoHoldemRoomSnapshot,
  type ClientToServerEvents,
  type GameRoom,
  type GameType,
  type ServerToClientEvents,
  type WinnerFeedEntry,
} from "@golden/contracts";
import { Shoe } from "@golden/game-core";
import type { AuthUser } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { casinoHoldemService, type CasinoHoldemSettlement } from "../casino-holdem/casino-holdem-service.js";
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
  enabled: boolean;
}

/** Time to decide Call/Fold after seeing hole cards + flop. Same 20s as PvP Hold'em's action clock. */
const DECISION_MS = 20_000;
/** How long the result stays on screen before the table resets to a fresh Ante prompt. */
const RESULT_MS = 6_000;

interface LiveHand {
  handId: string;
  phase: "DECISION" | "RESULT";
  ante: number;
  bonus: number;
  call: number;
  holeCards: Card[];
  dealerCards: Card[];
  /** Always the full 5-card board internally — only the flop (first 3) is exposed to the
   * client's snapshot until the hand reaches showdown. */
  board: Card[];
  decisionEndsAt: string | null;
  result: CasinoHoldemSettlement | null;
  token: number;
}

/**
 * Casino Hold'em vs the house. Unlike every other room actor in this app, there is no shared
 * table state — each connected user gets a fully private, independent hand keyed by their own
 * userId. One player's bet/deal/decision never touches another's.
 */
class CasinoHoldemRoomActor {
  private participants = new Map<string, Set<string>>();
  private hands = new Map<string, LiveHand>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private recentWinners: WinnerFeedEntry[] = [];
  private paused = false;

  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}

  get playerCount(): number {
    return this.participants.size;
  }

  private get channel(): string {
    return `casino-holdem-room:${this.room.id}`;
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
      // No shared table phase makes sense here — every player is on their own clock. WAITING is
      // just a fixed label for the lobby card; each snapshot's own `hand.phase` carries the truth.
      phase: "WAITING",
      enabled: this.room.enabled,
      paused: this.paused,
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
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

  async join(socket: GoldenSocket): Promise<CasinoHoldemRoomSnapshot> {
    const user = socket.data.user;
    const sockets = this.participants.get(user.id) ?? new Set<string>();
    sockets.add(socket.id);
    this.participants.set(user.id, sockets);
    await socket.join(this.channel);
    this.emitPresence();
    socket.emit("room.winners", { entries: this.recentWinners });
    return this.snapshot(user.id);
  }

  async leave(socket: GoldenSocket): Promise<void> {
    const userId = socket.data.user.id;
    const sockets = this.participants.get(userId);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) {
      this.participants.delete(userId);
      // A hand still awaiting a decision has real chips escrowed (Ante + Bonus) — settle it as
      // a fold immediately rather than leaving it stranded with nobody left to act on it.
      const hand = this.hands.get(userId);
      if (hand?.phase === "DECISION") await this.resolveFold(userId, hand);
      else this.hands.delete(userId);
    }
    await socket.leave(this.channel);
    this.emitPresence();
  }

  async bet(userId: string, command: CasinoHoldemBetCommand): Promise<CasinoHoldemRoomSnapshot> {
    if (!this.hasParticipant(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.paused) throw new Error("ROOM_PAUSED");
    const existing = this.hands.get(userId);
    if (existing && existing.phase !== "RESULT") throw new Error("HAND_IN_PROGRESS");
    const ante = command.ante;
    const bonus = command.bonus ?? 0;
    if (!Number.isInteger(ante) || ante < this.room.min_bet || ante > this.room.max_bet) throw new Error("BET_LIMIT");
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > this.room.max_bet) throw new Error("BET_LIMIT");
    // Ante's own Call doubles it, so this checks the worst case (Ante + Call + Bonus) up front —
    // failing here beats failing on Call after the player has already committed to the hand.
    const balance = await walletService.getUserBalance(userId);
    if (balance < ante * 3 + bonus) throw new Error("INSUFFICIENT_BALANCE");

    const shoe = new Shoe(1);
    const holeCards = [shoe.draw(), shoe.draw()];
    const dealerCards = [shoe.draw(), shoe.draw()];
    const board = [shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw(), shoe.draw()];

    const opened = await casinoHoldemService.openHand({
      requestId: command.requestId,
      roomId: this.room.id,
      userId,
      anteMinor: ante * COIN_SCALE,
      bonusMinor: bonus * COIN_SCALE,
      playerCards: holeCards,
      dealerCards,
      board,
    });

    const token = (this.hands.get(userId)?.token ?? 0) + 1;
    const hand: LiveHand = {
      handId: opened.handId,
      phase: "DECISION",
      ante,
      bonus,
      call: 0,
      holeCards,
      dealerCards,
      board,
      decisionEndsAt: new Date(Date.now() + DECISION_MS).toISOString(),
      result: null,
      token,
    };
    this.hands.set(userId, hand);
    this.armDecisionTimer(userId, token);
    await this.emitTo(userId);
    return this.snapshot(userId);
  }

  async decide(userId: string, command: CasinoHoldemDecideCommand): Promise<CasinoHoldemRoomSnapshot> {
    const hand = this.hands.get(userId);
    if (!hand || hand.handId !== command.handId || hand.phase !== "DECISION") throw new Error("NO_ACTIVE_HAND");
    this.clearTimer(userId);
    if (command.decision === "fold") {
      await this.resolveFold(userId, hand);
    } else {
      const callCoins = hand.ante * 2;
      const balance = await walletService.getUserBalance(userId);
      if (balance < callCoins) throw new Error("INSUFFICIENT_BALANCE");
      const settlement = await casinoHoldemService.settleCall({
        requestId: command.requestId,
        handId: hand.handId,
        roomId: this.room.id,
        userId,
        callMinor: callCoins * COIN_SCALE,
      });
      hand.call = callCoins;
      await this.applyResult(userId, hand, settlement);
    }
    return this.snapshot(userId);
  }

  private async resolveFold(userId: string, hand: LiveHand): Promise<void> {
    const settlement = await casinoHoldemService.settleFold(hand.handId, this.room.id, userId);
    await this.applyResult(userId, hand, settlement);
  }

  private async applyResult(userId: string, hand: LiveHand, settlement: CasinoHoldemSettlement): Promise<void> {
    hand.phase = "RESULT";
    hand.result = settlement;
    this.hands.set(userId, hand);
    if (settlement.profitMinor > 0) {
      const entry = buildWinnerEntry({
        roomId: this.room.id,
        game: "casino_holdem",
        username: (await pool.query<{ nickname: string }>("SELECT nickname FROM users WHERE id=$1", [userId])).rows[0]?.nickname ?? "player",
        choiceLabel: "카지노 홀덤",
        amount: settlement.profitMinor / COIN_SCALE,
      });
      this.recentWinners = pushWinnerEntries(this.recentWinners, [entry]);
      this.io.to(this.channel).emit("room.winners", { entries: this.recentWinners });
    }
    for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("wallet.updated", { balance: settlement.balance });
    await this.emitTo(userId);

    const token = hand.token;
    const timer = setTimeout(() => {
      void (async () => {
        if (this.hands.get(userId)?.token !== token) return;
        this.hands.delete(userId);
        await this.emitTo(userId);
      })();
    }, RESULT_MS);
    this.timers.set(`result:${userId}`, timer);
  }

  private armDecisionTimer(userId: string, token: number): void {
    this.clearTimer(userId);
    const timer = setTimeout(() => {
      void (async () => {
        const hand = this.hands.get(userId);
        if (!hand || hand.token !== token || hand.phase !== "DECISION") return;
        try {
          await this.resolveFold(userId, hand);
        } catch (error) {
          console.error(`Casino Hold'em room ${this.room.code} failed to auto-fold`, error);
        }
      })();
    }, DECISION_MS);
    this.timers.set(userId, timer);
  }

  private clearTimer(userId: string): void {
    const timer = this.timers.get(userId);
    if (timer) clearTimeout(timer);
    this.timers.delete(userId);
  }

  private handSnapshot(userId: string): CasinoHoldemHandSnapshot {
    const hand = this.hands.get(userId);
    if (!hand) return { handId: null, phase: "IDLE", ante: 0, bonus: 0, call: 0, holeCards: null, board: [], decisionEndsAt: null, result: null };
    const showdown = hand.phase === "RESULT";
    return {
      handId: hand.handId,
      phase: hand.phase,
      ante: hand.ante,
      bonus: hand.bonus,
      call: hand.call,
      holeCards: hand.holeCards,
      board: showdown ? hand.board : hand.board.slice(0, 3),
      decisionEndsAt: hand.phase === "DECISION" ? hand.decisionEndsAt : null,
      result: hand.result && showdown
        ? {
            handId: hand.handId,
            dealerCards: hand.result.dealerCards,
            dealerQualified: hand.result.dealerQualified,
            playerHandCategory: hand.result.playerHand?.category ?? null,
            dealerHandCategory: hand.result.dealerHand?.category ?? null,
            anteOutcome: hand.result.anteOutcome,
            callOutcome: hand.result.callOutcome,
            bonusOutcome: hand.result.bonusOutcome,
            antePayout: hand.result.antePayoutMinor / COIN_SCALE,
            callPayout: hand.result.callPayoutMinor / COIN_SCALE,
            bonusPayout: hand.result.bonusPayoutMinor / COIN_SCALE,
            netProfit: hand.result.profitMinor / COIN_SCALE,
          }
        : null,
    };
  }

  async snapshot(userId: string): Promise<CasinoHoldemRoomSnapshot> {
    return {
      room: this.publicRoom(),
      hand: this.handSnapshot(userId),
      walletBalance: await walletService.getUserBalance(userId),
    };
  }

  private emitPresence(): void {
    this.io.emit("room.presence", { roomId: this.room.id, playerCount: this.playerCount });
  }

  private async emitTo(userId: string): Promise<void> {
    const snapshot = await this.snapshot(userId);
    for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("casinoHoldem.snapshot", snapshot);
  }
}

export class CasinoHoldemRoomManager {
  private actors = new Map<string, CasinoHoldemRoomActor>();

  constructor(private readonly io: GoldenServer) {}

  async initialize(): Promise<void> {
    const rows = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,enabled FROM game_rooms WHERE game_type='casino_holdem'");
    for (const row of rows.rows) this.actors.set(row.id, new CasinoHoldemRoomActor(this.io, row));
  }

  listRooms(): GameRoom[] {
    return [...this.actors.values()].map((actor) => actor.publicRoom());
  }

  setPaused(roomId: string, paused: boolean): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.setPaused(paused);
    return true;
  }

  participantUserIds(roomId: string): string[] | null {
    return this.actors.get(roomId)?.participantUserIds() ?? null;
  }

  isParticipant(userId: string, roomId: string): boolean {
    return this.actors.get(roomId)?.hasParticipant(userId) ?? false;
  }

  async join(socket: GoldenSocket, roomId: string): Promise<CasinoHoldemRoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.join(socket);
  }

  async leave(socket: GoldenSocket, roomId: string): Promise<void> {
    await this.actors.get(roomId)?.leave(socket);
  }

  async disconnect(socket: GoldenSocket): Promise<void> {
    for (const actor of this.actors.values()) if (actor.hasSocket(socket.id)) await actor.leave(socket);
  }

  async bet(userId: string, command: CasinoHoldemBetCommand): Promise<CasinoHoldemRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.bet(userId, command);
  }

  async decide(userId: string, command: CasinoHoldemDecideCommand): Promise<CasinoHoldemRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.decide(userId, command);
  }
}
