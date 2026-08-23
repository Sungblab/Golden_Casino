import type { Server, Socket } from "socket.io";
import {
  COIN_SCALE,
  type BlackjackActionCommand,
  type BlackjackBetCommand,
  type BlackjackHandStatus,
  type BlackjackOutcome,
  type BlackjackPlayerHand,
  type BlackjackRoomSnapshot,
  type Card,
  type ClientToServerEvents,
  type GameRoom,
  type RoomPhase,
  type ServerToClientEvents,
  type WinnerFeedEntry,
} from "@golden/contracts";
import { dealerShouldHit, handValue, isBlackjack, Shoe } from "@golden/game-core";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { blackjackHandService, type BlackjackWin } from "../blackjack/hand-service.js";
import { buildWinnerEntry, pushWinnerEntries } from "../winner-feed.js";
import type { AuthUser } from "../../auth/auth.js";

const BLACKJACK_OUTCOME_LABEL: Record<BlackjackOutcome, string> = {
  win: "승리",
  lose: "패배",
  push: "푸시",
  blackjack: "블랙잭",
};

type GoldenServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;
type GoldenSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;

interface RoomRow {
  id: string;
  game_type: "baccarat" | "blackjack";
  code: string;
  name: string;
  min_bet: number;
  max_bet: number;
  enabled: boolean;
}

interface LiveHand {
  handId: string;
  userId: string;
  username: string;
  cards: Card[];
  bet: number;
  status: BlackjackHandStatus;
  outcome: BlackjackPlayerHand["outcome"];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const BETTING_MS = 12_000;
const PLAYER_TURN_MS = 20_000;
const DEALER_STEP_MS = 700;
const RESULT_MS = 4_500;

class BlackjackRoomActor {
  private phase: RoomPhase = "WAITING";
  private roundId: string | null = null;
  private phaseEndsAt: string | null = null;
  private sequence = 0;
  private shoe = new Shoe(6);
  private dealerCards: Card[] = [];
  private dealerHoleHidden = true;
  private hands = new Map<string, LiveHand>();
  private participants = new Map<string, Set<string>>();
  private usernames = new Map<string, string>();
  private recentWinners: WinnerFeedEntry[] = [];
  private cycleToken = 0;
  private cycleRunning = false;
  private paused = false;
  private playerTurnEarlyResolve: (() => void) | null = null;

  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}

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
    };
  }

  async join(socket: GoldenSocket): Promise<BlackjackRoomSnapshot> {
    const user = socket.data.user;
    const sockets = this.participants.get(user.id) ?? new Set<string>();
    sockets.add(socket.id);
    this.participants.set(user.id, sockets);
    this.usernames.set(user.id, user.username);
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

  async placeBet(userId: string, command: BlackjackBetCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    if (this.hands.has(userId)) throw new Error("BET_ALREADY_PLACED");
    await blackjackHandService.place(userId, command, this.room.min_bet, this.room.max_bet);
    this.hands.set(userId, {
      handId: command.requestId,
      userId,
      username: this.usernames.get(userId) ?? "player",
      cards: [],
      bet: command.amount,
      status: "playing",
      outcome: null,
    });
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async act(userId: string, command: BlackjackActionCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "PLAYER_TURN" || command.roundId !== this.roundId) throw new Error("NOT_YOUR_TURN");
    const hand = this.hands.get(userId);
    if (!hand || hand.status !== "playing") throw new Error("NO_ACTIVE_HAND");

    if (command.action === "hit") {
      hand.cards.push(this.draw());
      const value = handValue(hand.cards);
      if (value.total > 21) hand.status = "bust";
      else if (value.total === 21) hand.status = "stand";
    } else if (command.action === "stand") {
      hand.status = "stand";
    } else if (command.action === "double") {
      if (hand.cards.length !== 2) throw new Error("DOUBLE_NOT_ALLOWED");
      await blackjackHandService.placeDouble(userId, this.room.id, this.roundId!, hand.handId, hand.bet * COIN_SCALE);
      hand.bet *= 2;
      hand.cards.push(this.draw());
      // A double always ends the turn after exactly one more card — bust if it busts, otherwise "doubled"
      // (kept distinct from a plain stand so the settlement/UI can show it was doubled).
      hand.status = handValue(hand.cards).total > 21 ? "bust" : "doubled";
    }

    await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
    this.sequence += 1;
    await this.emitSnapshots();
    if ([...this.hands.values()].every((entry) => entry.status !== "playing")) this.advancePastPlayerTurn();
    return this.snapshot(userId);
  }

  async snapshot(userId: string): Promise<BlackjackRoomSnapshot> {
    const publicHands: BlackjackPlayerHand[] = [...this.hands.values()].map((hand) => ({
      userId: hand.userId,
      username: hand.username,
      cards: hand.cards,
      bet: hand.bet,
      status: hand.status,
      outcome: hand.outcome,
    }));
    const myHand = publicHands.find((hand) => hand.userId === userId) ?? null;
    const dealerCards = this.dealerHoleHidden ? this.dealerCards.slice(0, 1) : this.dealerCards;
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      phaseEndsAt: this.phaseEndsAt,
      dealerCards,
      dealerScore: this.dealerHoleHidden ? null : (this.dealerCards.length ? handValue(this.dealerCards).total : null),
      dealerHoleHidden: this.dealerHoleHidden,
      hands: publicHands,
      myBet: myHand?.bet ?? 0,
      myHand,
      walletBalance: await walletService.getUserBalance(userId),
      shoeRemaining: this.shoe.remaining,
    };
  }

  private draw(): Card {
    if (this.shoe.remaining < 15) this.shoe = new Shoe(6);
    return this.shoe.draw();
  }

  private get channel(): string {
    return `bj-room:${this.room.id}`;
  }

  private emitPresence(): void {
    this.io.emit("room.presence", { roomId: this.room.id, playerCount: this.playerCount });
  }

  /** Never let a broken feed entry take down round settlement — the ledger has already been written by now. */
  private broadcastWinners(wins: BlackjackWin[]): void {
    try {
      if (wins.length === 0) return;
      const entries = wins.map((win) =>
        buildWinnerEntry({
          roomId: this.room.id,
          game: "blackjack",
          username: this.usernames.get(win.userId) ?? "player",
          choiceLabel: BLACKJACK_OUTCOME_LABEL[win.outcome],
          amount: Math.floor(win.payoutMinor / COIN_SCALE),
        }),
      );
      this.recentWinners = pushWinnerEntries(this.recentWinners, entries);
      this.io.to(this.channel).emit("room.winners", { entries: this.recentWinners });
    } catch (error) {
      console.error(`Blackjack room ${this.room.code} failed to broadcast winner feed`, error);
    }
  }

  private async emitSnapshots(): Promise<void> {
    for (const [userId, sockets] of this.participants) {
      const snapshot = await this.snapshot(userId);
      for (const socketId of sockets) this.io.to(socketId).emit("blackjack.snapshot", snapshot);
    }
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.sequence += 1;
    if (this.roundId) await pool.query("UPDATE blackjack_rounds SET phase=$2 WHERE id=$1", [this.roundId, phase]);
    await this.emitSnapshots();
  }

  private launchCycle(): void {
    if (this.cycleRunning || this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    this.cycleRunning = true;
    void this.startCycle().catch(async (error) => {
      console.error(`Blackjack room ${this.room.code} cycle failed`, error);
      if (this.roundId) {
        try {
          await blackjackHandService.refundRound(this.roundId, this.room.id);
        } catch (refundError) {
          console.error(`Blackjack room ${this.room.code} refund failed`, refundError);
        }
      }
      this.resetRoundState();
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

  private resetRoundState(): void {
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.roundId = null;
    this.dealerCards = [];
    this.dealerHoleHidden = true;
    this.hands.clear();
  }

  /** Cuts the shared PLAYER_TURN timer short once every seated hand has already stood, bust, or blackjack'd. */
  private advancePastPlayerTurn(): void {
    if (this.phase !== "PLAYER_TURN") return;
    this.playerTurnEarlyResolve?.();
  }

  private waitForPlayerTurnEnd(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.playerTurnEarlyResolve = null;
        resolve();
      }, ms);
      this.playerTurnEarlyResolve = () => {
        clearTimeout(timer);
        this.playerTurnEarlyResolve = null;
        resolve();
      };
    });
  }

  private async startCycle(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.playerCount === 0) return;
    this.resetRoundState();
    const next = await pool.query<{ next_number: string }>(
      "SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM blackjack_rounds WHERE room_id=$1",
      [this.room.id],
    );
    const created = await pool.query<{ id: string }>(
      "INSERT INTO blackjack_rounds (room_id,round_number,phase) VALUES ($1,$2,'BETTING') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    const token = ++this.cycleToken;
    await this.setPhase("BETTING", BETTING_MS);
    await delay(BETTING_MS);
    if (token !== this.cycleToken) return;

    await this.setPhase("LOCKED", 700);
    if (this.hands.size === 0) {
      await pool.query("UPDATE blackjack_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [this.roundId]);
      await this.setPhase("RESULT", 2_000);
      await delay(2_000);
      this.resetRoundState();
      this.sequence += 1;
      await this.emitSnapshots();
      if (this.playerCount > 0) this.launchCycle();
      return;
    }
    await delay(700);

    // Deal: two cards to every seated hand, two to the dealer (second stays hidden).
    for (const hand of this.hands.values()) hand.cards.push(this.draw(), this.draw());
    this.dealerCards = [this.draw(), this.draw()];
    this.dealerHoleHidden = true;
    for (const hand of this.hands.values()) {
      if (isBlackjack(hand.cards)) hand.status = "blackjack";
      void blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
    }
    void blackjackHandService.recordDealer(this.roundId, this.dealerCards, null);

    const anyoneCanAct = [...this.hands.values()].some((hand) => hand.status === "playing");
    const turnMs = anyoneCanAct ? PLAYER_TURN_MS : 1_500;
    await this.setPhase("PLAYER_TURN", turnMs);
    await this.waitForPlayerTurnEnd(turnMs);
    for (const hand of this.hands.values()) if (hand.status === "playing") hand.status = "stand";

    await this.setPhase("DEALER_TURN", 1_500);
    this.dealerHoleHidden = false;
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(900);
    while (dealerShouldHit(this.dealerCards)) {
      this.dealerCards.push(this.draw());
      this.sequence += 1;
      await this.emitSnapshots();
      await delay(DEALER_STEP_MS);
    }
    void blackjackHandService.recordDealer(this.roundId, this.dealerCards, handValue(this.dealerCards).total);

    await this.setPhase("SETTLING", 1_000);
    const { balances, wins } = await blackjackHandService.settle(this.room.id, this.roundId, this.dealerCards);
    const finalHands = await blackjackHandService.handsForRound(this.roundId);
    for (const row of finalHands) {
      const hand = this.hands.get(row.userId);
      if (!hand) continue;
      const detailed = await pool.query<{ outcome: BlackjackPlayerHand["outcome"] }>("SELECT outcome FROM blackjack_hands WHERE id=$1", [row.id]);
      hand.outcome = detailed.rows[0]?.outcome ?? null;
    }
    for (const [userId, balance] of balances) {
      for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("wallet.updated", { balance });
    }
    this.broadcastWinners(wins);
    await pool.query("UPDATE blackjack_rounds SET phase='RESULT',settled_at=now() WHERE id=$1", [this.roundId]);
    await this.setPhase("RESULT", RESULT_MS);
    await delay(RESULT_MS);
    this.resetRoundState();
    this.sequence += 1;
    await this.emitSnapshots();
    if (this.playerCount > 0) this.launchCycle();
  }
}

export class BlackjackRoomManager {
  private actors = new Map<string, BlackjackRoomActor>();

  constructor(private readonly io: GoldenServer) {}

  async initialize(): Promise<void> {
    const recovered = await blackjackHandService.recoverInterruptedRounds();
    if (recovered > 0) console.warn(`Recovered ${recovered} interrupted blackjack rounds`);
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,enabled FROM game_rooms ORDER BY min_bet");
    for (const row of result.rows) {
      if (row.game_type !== "blackjack") continue;
      this.actors.set(row.id, new BlackjackRoomActor(this.io, row));
    }
  }

  listRooms(): GameRoom[] {
    return [...this.actors.values()].map((actor) => actor.publicRoom());
  }

  async join(socket: GoldenSocket, roomId: string): Promise<BlackjackRoomSnapshot> {
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

  async placeBet(userId: string, command: BlackjackBetCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.placeBet(userId, command);
  }

  async act(userId: string, command: BlackjackActionCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.act(userId, command);
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
