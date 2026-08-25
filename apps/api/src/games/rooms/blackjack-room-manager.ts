import type { Server, Socket } from "socket.io";
import {
  COIN_SCALE,
  type BlackjackActionCommand,
  type BlackjackBehindBetCommand,
  type BlackjackBehindBetSnapshot,
  type BlackjackBetCommand,
  type BlackjackCancelBehindCommand,
  type BlackjackCancelBetCommand,
  type BlackjackHandStatus,
  type BlackjackInsuranceCommand,
  type BlackjackOutcome,
  type BlackjackPlayerHand,
  type BlackjackRoomSnapshot,
  type BlackjackSeatCommand,
  type Card,
  type ClientToServerEvents,
  type GameRoom,
  type GameType,
  type RoomPhase,
  type ServerToClientEvents,
  type WinnerFeedEntry,
} from "@golden/contracts";
import { canSplitPair, dealerShouldHit, handValue, isBlackjack, Shoe } from "@golden/game-core";
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
  surrender: "서렌더",
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

interface LiveHand {
  handId: string;
  userId: string;
  username: string;
  seatNumber: number;
  handIndex: number;
  fromSplit: boolean;
  splitAces: boolean;
  cards: Card[];
  bet: number;
  status: BlackjackHandStatus;
  outcome: BlackjackPlayerHand["outcome"];
  lightningMultiplier: number;
}

interface LiveInsurance {
  amount: number;
  outcome: "win" | "lose" | null;
}

interface LiveBehindBet {
  betId: string;
  userId: string;
  username: string;
  targetSeat: number;
  targetHandId: string;
  amount: number;
  outcome: BlackjackOutcome | null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const BETTING_MS = 12_000;
const PLAYER_TURN_MS = 30_000;
const DEALER_STEP_MS = 700;
const RESULT_MS = 4_500;
const DEAL_STEP_MS = 260;
const INSURANCE_MS = 7_000;
const SEAT_COUNT = 7;

class BlackjackRoomActor {
  private phase: RoomPhase = "WAITING";
  private roundId: string | null = null;
  private phaseEndsAt: string | null = null;
  private sequence = 0;
  private shoe = new Shoe(6);
  private dealerCards: Card[] = [];
  private dealerHoleHidden = true;
  private hands = new Map<string, LiveHand>();
  private insuranceBets = new Map<string, LiveInsurance>();
  private behindBets = new Map<string, LiveBehindBet>();
  private seats: Array<string | null> = Array.from({ length: SEAT_COUNT }, () => null);
  private winStreaks = new Map<string, number>();
  private participants = new Map<string, Set<string>>();
  private usernames = new Map<string, string>();
  private recentWinners: WinnerFeedEntry[] = [];
  private cycleToken = 0;
  private cycleRunning = false;
  private paused = false;
  private playerTurnEarlyResolve: (() => void) | null = null;
  private actionRequests = new Set<string>();
  private nextLightningAwards = new Map<string, number>();
  /** Dev table rig only: force the next deal to give every seated hand a splittable pair. */
  private rigPairsNextRound = false;

  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}

  private get isLightning(): boolean {
    return this.room.game_type === "lightning_blackjack";
  }

  rigPairs(): void {
    this.rigPairsNextRound = true;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused && this.phase === "WAITING" && this.playerCount > 0) this.launchCycle();
  }

  get playerCount(): number {
    return this.seats.filter(Boolean).length;
  }

  private get participantCount(): number {
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
    this.usernames.set(user.id, user.nickname);
    await socket.join(this.channel);
    this.emitPresence();
    socket.emit("room.winners", { entries: this.recentWinners });
    if (this.phase === "WAITING" && this.playerCount > 0) this.launchCycle();
    return this.snapshot(user.id);
  }

  async leave(socket: GoldenSocket): Promise<void> {
    const userId = socket.data.user.id;
    const sockets = this.participants.get(userId);
    sockets?.delete(socket.id);
    if (sockets?.size === 0) {
      this.participants.delete(userId);
      if (this.userHands(userId).length === 0) this.releaseSeatFor(userId);
    }
    await socket.leave(this.channel);
    this.emitPresence();
    this.sequence += 1;
    await this.emitSnapshots();
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

  async claimSeat(userId: string, command: BlackjackSeatCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    const existingSeat = this.seatOf(userId);
    if (existingSeat === command.seatNumber) return this.snapshot(userId);
    if (existingSeat !== null) throw new Error("SEAT_ALREADY_CLAIMED");
    if (this.seats[command.seatNumber - 1]) throw new Error("SEAT_TAKEN");
    this.seats[command.seatNumber - 1] = userId;
    this.sequence += 1;
    this.emitPresence();
    await this.emitSnapshots();
    if (this.phase === "WAITING") this.launchCycle();
    return this.snapshot(userId);
  }

  async leaveSeat(userId: string): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.userHands(userId).length > 0) throw new Error("SEAT_LOCKED");
    this.releaseSeatFor(userId);
    this.sequence += 1;
    this.emitPresence();
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async placeBet(userId: string, command: BlackjackBetCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    const seatNumber = this.seatOf(userId);
    if (seatNumber === null) throw new Error("SEAT_REQUIRED");
    const placed = await blackjackHandService.place(userId, command, seatNumber, this.room.min_bet, this.room.max_bet, this.isLightning);
    const existing = this.userHands(userId)[0];
    if (existing) existing.bet = placed.totalBet;
    else this.hands.set(placed.handId, {
      handId: placed.handId,
      userId,
      username: this.usernames.get(userId) ?? "player",
      seatNumber,
      handIndex: 0,
      fromSplit: false,
      splitAces: false,
      cards: [],
      bet: placed.totalBet,
      status: "playing",
      outcome: null,
      lightningMultiplier: placed.lightningMultiplier,
    });
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async placeBehind(userId: string, command: BlackjackBehindBetCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    const targetUserId = this.seats[command.targetSeat - 1];
    if (!targetUserId) throw new Error("FOLLOW_TARGET_UNAVAILABLE");
    if (targetUserId === userId) throw new Error("CANNOT_FOLLOW_SELF");
    const targetHand = this.userHands(targetUserId)[0];
    if (!targetHand) throw new Error("FOLLOW_TARGET_UNAVAILABLE");
    const key = this.behindKey(userId, command.targetSeat);
    const placed = await blackjackHandService.placeBehind(userId, command, targetHand.handId, this.room.min_bet, this.room.max_bet);
    const existing = this.behindBets.get(key);
    if (existing) existing.amount = placed.totalBet;
    else this.behindBets.set(key, {
      betId: placed.betId,
      userId,
      username: this.usernames.get(userId) ?? "player",
      targetSeat: command.targetSeat,
      targetHandId: targetHand.handId,
      amount: placed.totalBet,
      outcome: null,
    });
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async cancelBet(userId: string, command: BlackjackCancelBetCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    const hand = this.userHands(userId)[0];
    if (!hand) throw new Error("BET_NOT_FOUND");
    await blackjackHandService.cancelBet(userId, this.room.id, this.roundId!);
    this.hands.delete(hand.handId);
    // Any follower riding on this hand was refunded and deleted server-side along with it.
    for (const [key, bet] of this.behindBets) if (bet.targetHandId === hand.handId) this.behindBets.delete(key);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async cancelBehind(userId: string, command: BlackjackCancelBehindCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "BETTING" || command.roundId !== this.roundId) throw new Error("BETTING_CLOSED");
    const key = this.behindKey(userId, command.targetSeat);
    if (!this.behindBets.has(key)) throw new Error("BET_NOT_FOUND");
    await blackjackHandService.cancelBehind(userId, this.room.id, this.roundId!, command.targetSeat);
    this.behindBets.delete(key);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async takeInsurance(userId: string, command: BlackjackInsuranceCommand): Promise<BlackjackRoomSnapshot> {
    if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.phase !== "INSURANCE" || command.roundId !== this.roundId || this.dealerCards[0]?.rank !== "A") throw new Error("INSURANCE_CLOSED");
    const hand = this.userHands(userId)[0];
    if (!hand) throw new Error("NO_ACTIVE_HAND");
    if (Math.floor(hand.bet / 2) < 1) throw new Error("INSURANCE_NOT_ALLOWED");
    const placed = await blackjackHandService.placeInsurance(userId, command, hand.handId, hand.bet * COIN_SCALE);
    this.insuranceBets.set(userId, { amount: placed.amount, outcome: null });
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async act(userId: string, command: BlackjackActionCommand): Promise<BlackjackRoomSnapshot> {
    if (this.actionRequests.has(command.requestId)) return this.snapshot(userId);
    this.actionRequests.add(command.requestId);
    let completed = false;
    try {
      if (!this.participants.has(userId)) throw new Error("ROOM_JOIN_REQUIRED");
      if (this.phase !== "PLAYER_TURN" || command.roundId !== this.roundId) throw new Error("NOT_YOUR_TURN");
      const hand = this.hands.get(command.handId);
      const activeHand = this.activeHandFor(userId);
      if (!hand || hand.userId !== userId || hand.handId !== activeHand?.handId || hand.status !== "playing") throw new Error("NO_ACTIVE_HAND");

      if (command.action === "hit") {
        hand.cards.push(this.draw());
        const value = handValue(hand.cards);
        if (value.total > 21) hand.status = "bust";
        else if (value.total === 21) hand.status = "stand";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      } else if (command.action === "stand") {
        hand.status = "stand";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      } else if (command.action === "double") {
        if (hand.cards.length !== 2 || hand.fromSplit) throw new Error("DOUBLE_NOT_ALLOWED");
        const reserved = await blackjackHandService.placeDouble(userId, this.room.id, this.roundId!, hand.handId, hand.bet * COIN_SCALE);
        if (!reserved.duplicate) {
          hand.bet *= 2;
          hand.cards.push(this.draw());
          hand.status = handValue(hand.cards).total > 21 ? "bust" : "doubled";
          await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
        }
      } else if (command.action === "surrender") {
        if (hand.cards.length !== 2 || hand.fromSplit || this.userHands(userId).length !== 1 || hand.bet % 2 !== 0) throw new Error("SURRENDER_NOT_ALLOWED");
        hand.status = "surrendered";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      } else if (command.action === "split") {
        const userHands = this.userHands(userId);
        if (!canSplitPair(hand.cards) || userHands.length >= 4 || hand.splitAces) throw new Error("SPLIT_NOT_ALLOWED");
        const originalCard = hand.cards[0]!;
        const splitCard = hand.cards[1]!;
        const splitAces = originalCard.rank === "A" && splitCard.rank === "A";
        const nextHandIndex = Math.max(...userHands.map((entry) => entry.handIndex)) + 1;
        const reserved = await blackjackHandService.splitHand({
          userId,
          roomId: this.room.id,
          roundId: this.roundId!,
          requestId: command.requestId,
          handId: hand.handId,
          seatNumber: hand.seatNumber,
          nextHandIndex,
          betMinor: hand.bet * COIN_SCALE,
          originalCard,
          splitCard,
          splitAces,
          lightningMultiplier: hand.lightningMultiplier,
        });
        if (!reserved.duplicate) {
          hand.cards = [originalCard, this.draw()];
          hand.fromSplit = true;
          hand.splitAces = splitAces;
          hand.status = splitAces || handValue(hand.cards).total === 21 ? "stand" : "playing";
          const newHand: LiveHand = {
            ...hand,
            handId: reserved.newHandId,
            handIndex: nextHandIndex,
            cards: [splitCard, this.draw()],
            status: "playing",
            outcome: null,
          };
          newHand.status = splitAces || handValue(newHand.cards).total === 21 ? "stand" : "playing";
          this.hands.set(newHand.handId, newHand);
          await Promise.all([
            blackjackHandService.syncHand(hand.handId, hand.cards, hand.status),
            blackjackHandService.syncHand(newHand.handId, newHand.cards, newHand.status),
          ]);
        }
      }

      completed = true;
      this.sequence += 1;
      await this.emitSnapshots();
      if ([...this.hands.values()].every((entry) => entry.status !== "playing")) this.advancePastPlayerTurn();
      return this.snapshot(userId);
    } finally {
      if (!completed) this.actionRequests.delete(command.requestId);
    }
  }

  async snapshot(userId: string): Promise<BlackjackRoomSnapshot> {
    const publicHands: BlackjackPlayerHand[] = [...this.hands.values()].sort((a, b) => a.seatNumber - b.seatNumber || a.handIndex - b.handIndex).map((hand) => ({
      handId: hand.handId,
      userId: hand.userId,
      username: hand.username,
      seatNumber: hand.seatNumber,
      handIndex: hand.handIndex,
      fromSplit: hand.fromSplit,
      splitAces: hand.splitAces,
      cards: hand.cards,
      bet: hand.bet,
      status: hand.status,
      outcome: hand.outcome,
    }));
    const myHands = publicHands.filter((hand) => hand.userId === userId);
    const activeLiveHand = this.activeHandFor(userId);
    const activeHandId = activeLiveHand?.handId ?? null;
    const myHand = publicHands.find((hand) => hand.handId === activeHandId) ?? myHands[0] ?? null;
    const myBehindBets: BlackjackBehindBetSnapshot[] = [...this.behindBets.values()]
      .filter((bet) => bet.userId === userId)
      .map((bet) => ({
        userId: bet.userId,
        username: bet.username,
        targetSeat: bet.targetSeat,
        amount: bet.amount,
        outcome: bet.outcome,
      }));
    const seats = this.seats.map((seatUserId, index) => {
      const seatNumber = index + 1;
      const seatHands = publicHands.filter((entry) => entry.seatNumber === seatNumber);
      const hand = seatHands.find((entry) => entry.status === "playing") ?? seatHands[0] ?? null;
      const followers = [...this.behindBets.values()].filter((bet) => bet.targetSeat === seatNumber);
      return {
        seatNumber,
        userId: seatUserId,
        username: seatUserId ? (this.usernames.get(seatUserId) ?? "player") : null,
        hand,
        hands: seatHands,
        behindBetTotal: followers.reduce((sum, bet) => sum + bet.amount, 0),
        behindBetCount: followers.length,
        myBehindBet: followers.find((bet) => bet.userId === userId)?.amount ?? 0,
        winStreak: seatUserId ? (this.winStreaks.get(seatUserId) ?? 0) : 0,
      };
    });
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
      seats,
      mySeat: this.seatOf(userId),
      spectatorCount: Math.max(0, this.participantCount - this.playerCount),
      behindBets: myBehindBets,
      myBet: myHands.reduce((sum, hand) => sum + hand.bet, 0),
      myHand,
      myHands,
      activeHandId,
      insuranceOffered: this.phase === "INSURANCE" && this.dealerCards[0]?.rank === "A",
      myInsurance: this.insuranceBets.get(userId) ?? null,
      walletBalance: await walletService.getUserBalance(userId),
      shoeRemaining: this.shoe.remaining,
      lightningFeePercent: this.isLightning ? 100 : 0,
      activeLightningMultiplier: myHands[0] ? (this.hands.get(myHands[0].handId)?.lightningMultiplier ?? 1) : null,
      nextLightningMultiplier: this.nextLightningAwards.get(userId) ?? null,
    };
  }

  private draw(): Card {
    if (this.shoe.remaining < 15) this.shoe = new Shoe(6);
    return this.shoe.draw();
  }

  private userHands(userId: string): LiveHand[] {
    return [...this.hands.values()].filter((hand) => hand.userId === userId).sort((a, b) => a.handIndex - b.handIndex);
  }

  private activeHandFor(userId: string): LiveHand | null {
    return this.userHands(userId).find((hand) => hand.status === "playing") ?? null;
  }

  private seatOf(userId: string): number | null {
    const index = this.seats.indexOf(userId);
    return index === -1 ? null : index + 1;
  }

  private releaseSeatFor(userId: string): void {
    const index = this.seats.indexOf(userId);
    if (index !== -1) this.seats[index] = null;
  }

  private releaseDisconnectedSeats(): void {
    this.seats = this.seats.map((userId) => (userId && this.participants.has(userId) ? userId : null));
  }

  private behindKey(userId: string, targetSeat: number): string {
    return `${userId}:${targetSeat}`;
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
          game: this.room.game_type,
          username: this.usernames.get(win.userId) ?? "player",
          choiceLabel: win.outcome === "insurance" ? "보험" : BLACKJACK_OUTCOME_LABEL[win.outcome],
          amount: win.profitMinor / COIN_SCALE,
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
    this.behindBets.clear();
    this.insuranceBets.clear();
    this.actionRequests.clear();
    this.nextLightningAwards.clear();
    this.releaseDisconnectedSeats();
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

    // Deal in the same visible order as a live seven-seat table. Every step emits a
    // snapshot so all clients see the same alternating card timeline.
    const orderedHands = [...this.hands.values()].sort((a, b) => a.seatNumber - b.seatNumber);
    if (this.rigPairsNextRound) {
      this.rigPairsNextRound = false;
      // draw() reshuffles a nearly spent shoe, which would throw the rig away mid-deal.
      if (this.shoe.remaining < 40) this.shoe = new Shoe(6);
      this.shoe.stack(riggedPairShoe(orderedHands.length));
    }
    const dealDuration = Math.max(1_800, (orderedHands.length + 1) * 2 * DEAL_STEP_MS + 500);
    await this.setPhase("DEALING", dealDuration);
    this.dealerCards = [];
    this.dealerHoleHidden = true;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const hand of orderedHands) {
        hand.cards.push(this.draw());
        this.sequence += 1;
        await this.emitSnapshots();
        await delay(DEAL_STEP_MS);
      }
      this.dealerCards.push(this.draw());
      this.sequence += 1;
      await this.emitSnapshots();
      await delay(DEAL_STEP_MS);
    }
    for (const hand of orderedHands) {
      if (isBlackjack(hand.cards)) hand.status = "blackjack";
      await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
    }
    await blackjackHandService.recordDealer(this.roundId, this.dealerCards, null);

    const dealerUpcard = this.dealerCards[0]!;
    if (dealerUpcard.rank === "A") {
      await this.setPhase("INSURANCE", INSURANCE_MS);
      await delay(INSURANCE_MS);
    }
    const dealerBlackjack = isBlackjack(this.dealerCards);
    for (const insurance of this.insuranceBets.values()) insurance.outcome = dealerBlackjack ? "win" : "lose";

    if (!dealerBlackjack) {
      const anyoneCanAct = [...this.hands.values()].some((hand) => hand.status === "playing");
      const turnMs = anyoneCanAct ? PLAYER_TURN_MS : 1_500;
      await this.setPhase("PLAYER_TURN", turnMs);
      await this.waitForPlayerTurnEnd(turnMs);
      for (const hand of this.hands.values()) {
        if (hand.status !== "playing") continue;
        hand.status = "stand";
        await blackjackHandService.syncHand(hand.handId, hand.cards, hand.status);
      }
    }

    await this.setPhase("DEALER_TURN", dealerBlackjack ? 1_500 : 5_000);
    this.dealerHoleHidden = false;
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(900);
    const dealerNeedsPlay = [...this.hands.values()].some((hand) => !["bust", "surrendered", "blackjack"].includes(hand.status));
    while (!dealerBlackjack && dealerNeedsPlay && dealerShouldHit(this.dealerCards)) {
      this.dealerCards.push(this.draw());
      this.sequence += 1;
      await this.emitSnapshots();
      await delay(DEALER_STEP_MS);
    }
    await blackjackHandService.recordDealer(this.roundId, this.dealerCards, handValue(this.dealerCards).total);

    await this.setPhase("SETTLING", 1_000);
    const { balances, wins, lightningAwards } = await blackjackHandService.settle(this.room.id, this.roundId, this.dealerCards, this.isLightning);
    this.nextLightningAwards = lightningAwards;
    const finalHands = await blackjackHandService.handsForRound(this.roundId);
    const userWon = new Map<string, boolean>();
    for (const row of finalHands) {
      const hand = this.hands.get(row.id);
      if (!hand) continue;
      const detailed = await pool.query<{ outcome: BlackjackPlayerHand["outcome"] }>("SELECT outcome FROM blackjack_hands WHERE id=$1", [row.id]);
      hand.outcome = detailed.rows[0]?.outcome ?? null;
      if (hand.outcome === "win" || hand.outcome === "blackjack") userWon.set(hand.userId, true);
    }
    for (const userId of new Set(finalHands.map((hand) => hand.userId))) this.winStreaks.set(userId, userWon.get(userId) ? (this.winStreaks.get(userId) ?? 0) + 1 : 0);
    const finalBehindBets = await blackjackHandService.behindBetsForRound(this.roundId);
    for (const row of finalBehindBets) {
      const live = this.behindBets.get(this.behindKey(row.userId, row.targetSeat));
      if (live) live.outcome = row.outcome;
    }
    const finalInsurance = await blackjackHandService.insuranceForRound(this.roundId);
    for (const row of finalInsurance) {
      const live = this.insuranceBets.get(row.userId);
      if (live) live.outcome = row.outcome;
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
      if (row.game_type !== "blackjack" && row.game_type !== "lightning_blackjack") continue;
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

  async cancelBet(userId: string, command: BlackjackCancelBetCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.cancelBet(userId, command);
  }

  async cancelBehind(userId: string, command: BlackjackCancelBehindCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.cancelBehind(userId, command);
  }

  async claimSeat(userId: string, command: BlackjackSeatCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.claimSeat(userId, command);
  }

  async leaveSeat(userId: string, roomId: string): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.leaveSeat(userId);
  }

  async placeBehind(userId: string, command: BlackjackBehindBetCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.placeBehind(userId, command);
  }

  async takeInsurance(userId: string, command: BlackjackInsuranceCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.takeInsurance(userId, command);
  }

  async act(userId: string, command: BlackjackActionCommand): Promise<BlackjackRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.act(userId, command);
  }

  isParticipant(userId: string, roomId: string): boolean {
    return this.actors.get(roomId)?.hasParticipant(userId) ?? false;
  }

  participantUserIds(roomId: string): string[] | null {
    return this.actors.get(roomId)?.participantUserIds() ?? null;
  }

  setPaused(roomId: string, paused: boolean): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.setPaused(paused);
    return true;
  }

  /** Dev table rig only — see config.devTableRig. */
  rigPairs(roomId: string): boolean {
    const actor = this.actors.get(roomId);
    if (!actor) return false;
    actor.rigPairs();
    return true;
  }
}

/**
 * The card sequence that makes the next deal give every seated hand a pair, laid out in
 * the exact order `runCycle` draws it: one card per hand in seat order, dealer upcard,
 * then the same again for the hole card. Each seat gets a different rank so hands stay
 * telling apart on screen, and the dealer gets 7/9 - no ace, no blackjack, so the deal
 * runs straight into PLAYER_TURN without an insurance detour.
 */
function riggedPairShoe(handCount: number): Card[] {
  const ranks: Card["rank"][] = ["8", "9", "7", "6", "4", "3", "2"];
  const first: Card[] = [];
  const second: Card[] = [];
  for (let index = 0; index < handCount; index += 1) {
    const rank = ranks[index % ranks.length]!;
    first.push({ rank, suit: "S" });
    second.push({ rank, suit: "H" });
  }
  return [...first, { rank: "7", suit: "D" }, ...second, { rank: "9", suit: "C" }];
}
