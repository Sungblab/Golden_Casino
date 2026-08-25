import type { Server, Socket } from "socket.io";
import {
  COIN_SCALE,
  type Card,
  type ClientToServerEvents,
  type GameRoom,
  type GameType,
  type HoldemActionCommand,
  type HoldemPotSnapshot,
  type HoldemRoomSnapshot,
  type HoldemSeatCommand,
  type HoldemSeatSnapshot,
  type HoldemStreet,
  type HoldemWinnerSnapshot,
  type RoomPhase,
  type ServerToClientEvents,
  type WinnerFeedEntry,
} from "@golden/contracts";
import { buildHoldemPots, evaluateBestHoldemHand, Shoe } from "@golden/game-core";
import type { AuthUser } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { holdemService } from "../holdem/holdem-service.js";
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

interface SeatState {
  userId: string;
  username: string;
  folded: boolean;
  allIn: boolean;
  streetContributed: number;
  totalContributed: number;
  holeCards: Card[];
}

const SEAT_COUNT = 6;
const BETWEEN_HANDS_MS = 4_000;
/** Idle window held open after a hand fully settles, before the next is dealt. This is the only
 *  point at which a seated player can stand up or un-ready, so it needs to be long enough to
 *  notice and click in — not just long enough to read the result. */
const HAND_BREAK_MS = 6_000;
const ACTION_MS = 20_000;
const REVEAL_STEP_MS = 900;
const SHOWDOWN_MS = 5_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class HoldemRoomActor {
  private phase: RoomPhase = "WAITING";
  private roundId: string | null = null;
  private phaseEndsAt: string | null = null;
  private sequence = 0;
  private shoe = new Shoe(1);
  private street: HoldemStreet | null = null;
  private board: Card[] = [];
  private seats: Array<SeatState | null> = Array.from({ length: SEAT_COUNT }, () => null);
  private sittingOut = new Set<string>();
  // A hand only auto-launches once every seated player has explicitly readied up. Sticky
  // across hands once set — a player stays ready until they un-ready or stand up, not just
  // for the next hand — so regulars don't have to re-click it after every single hand.
  private ready = new Set<string>();
  private buttonSeat = 0;
  private smallBlindSeat: number | null = null;
  private bigBlindSeat: number | null = null;
  private actingSeat: number | null = null;
  private currentBet = 0;
  private minRaise = 0;
  private actedSinceLastRaise = new Set<number>();
  private lastWinners: HoldemWinnerSnapshot[] = [];
  private participants = new Map<string, Set<string>>();
  private usernames = new Map<string, string>();
  private recentWinners: WinnerFeedEntry[] = [];
  private cycleRunning = false;
  private cycleToken = 0;
  private paused = false;
  private actionRequests = new Set<string>();
  private turnResolve: (() => void) | null = null;

  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}

  get playerCount(): number {
    return this.participants.size;
  }

  private get seatedCount(): number {
    return this.seats.filter(Boolean).length;
  }

  private get channel(): string {
    return `holdem-room:${this.room.id}`;
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

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused && this.phase === "WAITING") this.launchCycle();
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

  async join(socket: GoldenSocket): Promise<HoldemRoomSnapshot> {
    const user = socket.data.user;
    const sockets = this.participants.get(user.id) ?? new Set<string>();
    sockets.add(socket.id);
    this.participants.set(user.id, sockets);
    this.usernames.set(user.id, user.nickname);
    // A reconnect (page refresh, brief network blip) must not read as "still gone" —
    // otherwise the next hand boundary would silently drop their seat from under them.
    this.sittingOut.delete(user.id);
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
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      if (index !== -1) {
        const seat = this.seats[index]!;
        // Mid-hand with live chips: keep the seat marked sitting-out so it folds when its
        // turn comes and only clears once the hand settles (resetHandState), same as an AFK
        // player. Otherwise nothing is at stake, so free the seat immediately — waiting for
        // the next hand cycle to reap it could strand it forever if too few players remain
        // seated for a hand to ever start.
        if (this.roundId && seat.totalContributed > 0 && !seat.folded) {
          this.sittingOut.add(userId);
        } else {
          this.seats[index] = null;
          this.ready.delete(userId);
        }
        this.sequence += 1;
      }
    }
    await socket.leave(this.channel);
    this.emitPresence();
    await this.emitSnapshots();
  }

  async sit(userId: string, command: HoldemSeatCommand): Promise<HoldemRoomSnapshot> {
    if (!this.hasParticipant(userId)) throw new Error("ROOM_JOIN_REQUIRED");
    if (this.seats.some((seat) => seat?.userId === userId)) throw new Error("ALREADY_SEATED");
    const index = command.seatNumber - 1;
    if (index < 0 || index >= SEAT_COUNT || this.seats[index]) throw new Error("SEAT_TAKEN");
    const balance = await walletService.getUserBalance(userId);
    if (balance < this.room.min_bet * 2) throw new Error("INSUFFICIENT_BALANCE");
    this.seats[index] = { userId, username: this.usernames.get(userId) ?? "player", folded: false, allIn: false, streetContributed: 0, totalContributed: 0, holeCards: [] };
    this.sittingOut.delete(userId);
    this.sequence += 1;
    await this.emitSnapshots();
    // No auto-launch here anymore — sitting down no longer implies wanting to play the very
    // next hand. The player still has to ready up (see setReady) before a hand can start.
    return this.snapshot(userId);
  }

  async standUp(userId: string): Promise<HoldemRoomSnapshot> {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index === -1) throw new Error("NOT_SEATED");
    const seat = this.seats[index]!;
    // Mid-hand: leave the chips in the pot (they fold when their turn comes) and only
    // clear the seat once the hand settles, so pot accounting never has a gap.
    if (this.roundId && seat.totalContributed > 0 && !seat.folded) {
      this.sittingOut.add(userId);
    } else {
      this.seats[index] = null;
    }
    this.ready.delete(userId);
    this.sequence += 1;
    await this.emitSnapshots();
    return this.snapshot(userId);
  }

  async setReady(userId: string, readyValue: boolean): Promise<HoldemRoomSnapshot> {
    if (!this.seats.some((seat) => seat?.userId === userId)) throw new Error("NOT_SEATED");
    if (readyValue) this.ready.add(userId);
    else this.ready.delete(userId);
    this.sequence += 1;
    await this.emitSnapshots();
    if (readyValue) this.launchCycle();
    return this.snapshot(userId);
  }

  async act(userId: string, command: HoldemActionCommand): Promise<HoldemRoomSnapshot> {
    if (this.actionRequests.has(command.requestId)) return this.snapshot(userId);
    this.actionRequests.add(command.requestId);
    let completed = false;
    try {
      const seatIndex = this.seats.findIndex((seat) => seat?.userId === userId);
      if (seatIndex === -1) throw new Error("NOT_SEATED");
      if (this.phase !== "PLAYER_TURN" || command.roundId !== this.roundId || this.actingSeat !== seatIndex + 1) throw new Error("NOT_YOUR_TURN");
      await this.applyAction(seatIndex, command.action, command.amount);
      completed = true;
      this.sequence += 1;
      await this.emitSnapshots();
      this.resolveTurnEarly();
      return this.snapshot(userId);
    } finally {
      if (!completed) this.actionRequests.delete(command.requestId);
    }
  }

  private async applyAction(seatIndex: number, action: HoldemActionCommand["action"], rawAmount: number | undefined): Promise<void> {
    const seat = this.seats[seatIndex]!;
    const toCall = this.currentBet - seat.streetContributed;
    if (action === "fold") {
      seat.folded = true;
      await holdemService.markFolded(this.roundId!, seat.userId);
      return;
    }
    if (action === "check") {
      if (toCall > 0) throw new Error("MUST_CALL_OR_FOLD");
      this.actedSinceLastRaise.add(seatIndex);
      return;
    }
    const balance = await walletService.getUserBalance(seat.userId);
    if (action === "call") {
      const amountMinor = Math.min(toCall, balance) * COIN_SCALE;
      if (amountMinor > 0) await this.contribute(seat, seatIndex, amountMinor);
      if (Math.min(toCall, balance) < toCall) await this.setAllIn(seat, seatIndex);
      this.actedSinceLastRaise.add(seatIndex);
      return;
    }
    if (action === "bet" || action === "raise" || action === "allin") {
      const targetTotal = action === "allin" ? seat.streetContributed + balance : rawAmount;
      if (!Number.isInteger(targetTotal) || targetTotal === undefined) throw new Error("INVALID_ACTION");
      if (targetTotal <= this.currentBet) throw new Error("RAISE_TOO_SMALL");
      const increment = targetTotal - seat.streetContributed;
      if (increment > balance) throw new Error("INSUFFICIENT_BALANCE");
      const raiseSize = targetTotal - this.currentBet;
      const isFullRaise = raiseSize >= this.minRaise || increment === balance /* short all-in allowed */;
      if (raiseSize < this.minRaise && increment < balance) throw new Error("RAISE_TOO_SMALL");
      await this.contribute(seat, seatIndex, increment * COIN_SCALE);
      if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
      this.currentBet = seat.streetContributed;
      if (isFullRaise && raiseSize >= this.minRaise) {
        this.actedSinceLastRaise = new Set([seatIndex]);
      } else {
        this.actedSinceLastRaise.add(seatIndex);
      }
      if (increment === balance) await this.setAllIn(seat, seatIndex);
      return;
    }
  }

  private async contribute(seat: SeatState, seatIndex: number, amountMinor: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await holdemService.contribute(client, {
        // Each contribution moves the running total forward by a strictly increasing amount,
        // so keying on the pre-contribution total makes a resent request a safe no-op retry.
        requestId: `${this.roundId}:${seat.userId}:${seat.totalContributed}`,
        userId: seat.userId,
        roomId: this.room.id,
        roundId: this.roundId!,
        seatNumber: seatIndex + 1,
        amountMinor,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const amount = amountMinor / COIN_SCALE;
    seat.streetContributed += amount;
    seat.totalContributed += amount;
  }

  private async setAllIn(seat: SeatState, seatIndex: number): Promise<void> {
    seat.allIn = true;
    await holdemService.markAllIn(this.roundId!, seat.userId, true);
    this.actedSinceLastRaise.add(seatIndex);
  }

  async snapshot(userId: string): Promise<HoldemRoomSnapshot> {
    const mySeatIndex = this.seats.findIndex((seat) => seat?.userId === userId);
    const showCards = this.street === "showdown";
    const seats: HoldemSeatSnapshot[] = await Promise.all(this.seats.map(async (seat, index) => {
      const seatNumber = index + 1;
      if (!seat) {
        return {
          seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
          folded: false, allIn: false, sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false,
          isTurn: false, holeCards: null, handCategory: null, ready: false,
        };
      }
      const mine = seat.userId === userId;
      return {
        seatNumber,
        userId: seat.userId,
        username: seat.username,
        stack: await walletService.getUserBalance(seat.userId),
        streetContributed: seat.streetContributed,
        totalContributed: seat.totalContributed,
        folded: seat.folded,
        allIn: seat.allIn,
        sittingOut: this.sittingOut.has(seat.userId),
        isButton: seatNumber === this.buttonSeat,
        isSmallBlind: seatNumber === this.smallBlindSeat,
        isBigBlind: seatNumber === this.bigBlindSeat,
        isTurn: seatNumber === this.actingSeat,
        holeCards: mine || (showCards && !seat.folded) ? (seat.holeCards.length ? seat.holeCards : null) : null,
        // Needs the >= 5 card guard, not just "has hole cards": when everyone folds preflop the
        // hand reaches showdown with an empty board, so this evaluated 2 cards and threw. That
        // exception escaped through emitSnapshots into the cycle's catch, which refunded the pot
        // and immediately re-dealt — so a seated player saw hands restart in a loop and could
        // never reach the between-hands window where standing up is allowed.
        handCategory: showCards && !seat.folded && seat.holeCards.length + this.board.length >= 5
          ? evaluateBestHoldemHand([...seat.holeCards, ...this.board]).category
          : null,
        ready: this.ready.has(seat.userId),
      };
    }));
    const mySeat = mySeatIndex >= 0 ? this.seats[mySeatIndex] : null;
    const toCall = mySeat ? Math.max(0, this.currentBet - mySeat.streetContributed) : 0;
    return {
      room: this.publicRoom(),
      roundId: this.roundId,
      sequence: this.sequence,
      phaseEndsAt: this.phaseEndsAt,
      street: this.street,
      board: this.board,
      pots: this.potSnapshots(),
      seats,
      mySeatNumber: mySeatIndex >= 0 ? mySeatIndex + 1 : null,
      toCall,
      minRaiseTo: this.currentBet + this.minRaise,
      actingSeat: this.phase === "PLAYER_TURN" ? this.actingSeat : null,
      lastWinners: this.lastWinners,
      walletBalance: await walletService.getUserBalance(userId),
    };
  }

  private potSnapshots(): HoldemPotSnapshot[] {
    const contributions = this.seats
      .map((seat, index) => (seat ? { userId: seat.userId, amount: seat.totalContributed, folded: seat.folded, seatNumber: index + 1 } : null))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.amount > 0);
    const seatByUser = new Map(contributions.map((entry) => [entry.userId, entry.seatNumber]));
    return buildHoldemPots(contributions).map((pot) => ({
      amount: pot.amount,
      eligibleSeats: pot.eligibleUserIds.map((userId) => seatByUser.get(userId)!).filter((seat): seat is number => seat !== undefined),
    }));
  }

  private emitPresence(): void {
    this.io.emit("room.presence", { roomId: this.room.id, playerCount: this.playerCount });
  }

  private async emitSnapshots(): Promise<void> {
    for (const [userId, sockets] of this.participants) {
      const snapshot = await this.snapshot(userId);
      for (const socketId of sockets) this.io.to(socketId).emit("holdem.snapshot", snapshot);
    }
  }

  private broadcastWinners(winners: HoldemWinnerSnapshot[]): void {
    try {
      if (winners.length === 0) return;
      const entries = winners.map((winner) => buildWinnerEntry({
        roomId: this.room.id,
        game: "holdem",
        username: winner.username,
        choiceLabel: (winner.handCategory && HAND_LABEL[winner.handCategory]) || "팟 획득",
        amount: winner.amount,
      }));
      this.recentWinners = pushWinnerEntries(this.recentWinners, entries);
      this.io.to(this.channel).emit("room.winners", { entries: this.recentWinners });
    } catch (error) {
      console.error(`Hold'em room ${this.room.code} failed to broadcast winner feed`, error);
    }
  }

  private async setPhase(phase: RoomPhase, durationMs?: number): Promise<void> {
    this.phase = phase;
    this.phaseEndsAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    this.sequence += 1;
    await this.emitSnapshots();
  }

  private resolveTurnEarly(): void {
    this.turnResolve?.();
  }

  private waitForTurn(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.turnResolve = null;
        resolve();
      }, ms);
      this.turnResolve = () => {
        clearTimeout(timer);
        this.turnResolve = null;
        resolve();
      };
    });
  }

  /** Every occupied seat has readied up — the only condition (besides seatedCount) that
   *  actually starts a hand now, instead of two seats filling being enough on its own. */
  private allSeatedReady(): boolean {
    return this.seats.every((seat) => !seat || this.ready.has(seat.userId));
  }

  private launchCycle(): void {
    if (this.cycleRunning || this.paused || this.phase !== "WAITING" || this.seatedCount < 2 || !this.allSeatedReady()) return;
    this.cycleRunning = true;
    void this.startHand().catch(async (error) => {
      console.error(`Hold'em room ${this.room.code} hand failed`, error);
      if (this.roundId) await holdemService.refundRound(this.roundId, this.room.id).catch(console.error);
      this.resetHandState();
      this.sequence += 1;
      await this.emitSnapshots();
      for (const sockets of this.participants.values()) {
        for (const socketId of sockets) this.io.to(socketId).emit("notification", { type: "error", message: "핸드가 중단되어 참가한 베팅을 환불했습니다." });
      }
    }).finally(() => {
      this.cycleRunning = false;
      if (this.phase === "WAITING") this.launchCycle();
    });
  }

  private resetHandState(): void {
    this.phase = "WAITING";
    this.phaseEndsAt = null;
    this.roundId = null;
    this.street = null;
    this.board = [];
    this.currentBet = 0;
    this.minRaise = 0;
    this.actingSeat = null;
    this.actedSinceLastRaise.clear();
    this.actionRequests.clear();
    for (const userId of this.sittingOut) {
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      if (index !== -1) this.seats[index] = null;
    }
    this.sittingOut.clear();
    // Deliberately NOT clearing `ready` here: once a player readies up it's a standing
    // preference that carries into the next hand, not a one-shot gate — they only stop being
    // ready by explicitly un-readying or standing up (see setReady/standUp).
  }

  private seatOrderFrom(startSeat: number): number[] {
    const order: number[] = [];
    for (let offset = 0; offset < SEAT_COUNT; offset += 1) {
      const seatNumber = ((startSeat - 1 + offset) % SEAT_COUNT) + 1;
      if (this.seats[seatNumber - 1]) order.push(seatNumber);
    }
    return order;
  }

  private contenderSeats(): number[] {
    return this.seats.map((seat, index) => (seat && !seat.folded ? index + 1 : null)).filter((seat): seat is number => seat !== null);
  }

  private activeSeats(): number[] {
    return this.contenderSeats().filter((seatNumber) => !this.seats[seatNumber - 1]!.allIn);
  }

  private async startHand(): Promise<void> {
    if (this.paused || this.phase !== "WAITING" || this.seatedCount < 2) return;
    const token = ++this.cycleToken;
    // Drop any seat whose owner cannot cover a big blind so the hand only deals in players who can act.
    for (let index = 0; index < SEAT_COUNT; index += 1) {
      const seat = this.seats[index];
      if (seat && (await walletService.getUserBalance(seat.userId)) < this.room.min_bet) this.sittingOut.add(seat.userId);
    }
    const seatedOrder = this.seats.map((seat, index) => (seat && !this.sittingOut.has(seat.userId) ? index + 1 : null)).filter((seat): seat is number => seat !== null);
    if (seatedOrder.length < 2) return;

    for (const seatNumber of seatedOrder) {
      const seat = this.seats[seatNumber - 1]!;
      seat.folded = false;
      seat.allIn = false;
      seat.streetContributed = 0;
      seat.totalContributed = 0;
      seat.holeCards = [];
    }

    this.buttonSeat = this.nextButtonSeat(seatedOrder);
    const order = this.seatOrderFrom(this.buttonSeat).filter((seat) => seatedOrder.includes(seat));
    const headsUp = order.length === 2;
    this.smallBlindSeat = headsUp ? this.buttonSeat : order[1]!;
    this.bigBlindSeat = headsUp ? order[1]! : order[2]!;

    const next = await pool.query<{ next_number: string }>("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1", [this.room.id]);
    const created = await pool.query<{ id: string }>(
      "INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING','holdem-v1') RETURNING id",
      [this.room.id, Number(next.rows[0]!.next_number)],
    );
    this.roundId = created.rows[0]!.id;
    this.board = [];
    this.lastWinners = [];
    if (this.shoe.remaining < 20) this.shoe = new Shoe(1);
    await this.setPhase("DEALING", REVEAL_STEP_MS);

    for (const seatNumber of order) {
      const seat = this.seats[seatNumber - 1]!;
      seat.holeCards = [this.shoe.draw(), this.shoe.draw()];
      await holdemService.recordHoleCards(this.roundId, seat.userId, seat.holeCards);
    }
    await delay(REVEAL_STEP_MS);
    if (token !== this.cycleToken) return;

    // Blinds are forced contributions, not player actions — short-stacked blinds go all-in automatically.
    await this.postBlind(this.smallBlindSeat, this.room.min_bet);
    await this.postBlind(this.bigBlindSeat, this.room.min_bet * 2);
    this.currentBet = this.room.min_bet * 2;
    this.minRaise = this.room.min_bet * 2;

    this.street = "preflop";
    const preflopFirst = headsUp ? this.buttonSeat : order[3] ?? order[0]!;
    await this.runBettingRound(preflopFirst, order, token);
    if (token !== this.cycleToken) return;

    if (this.contenderSeats().length > 1) {
      await this.dealStreet("flop", 3, order, token);
      if (token !== this.cycleToken) return;
      await this.dealStreet("turn", 1, order, token);
      if (token !== this.cycleToken) return;
      await this.dealStreet("river", 1, order, token);
      if (token !== this.cycleToken) return;
    }

    await this.showdown();
    if (token !== this.cycleToken) return;
    await delay(this.contenderSeats().length > 1 || this.board.length === 5 ? SHOWDOWN_MS : BETWEEN_HANDS_MS);
    this.resetHandState();
    // An explicit idle window between hands. Without it the next hand was dealt on the same tick
    // the previous one settled, so `roundId` was never null while a player was looking at the
    // table — and standing up (or un-readying) is only allowed when no hand is in flight, which
    // made a seated player unable to ever leave: cards just kept coming. phaseEndsAt gives the
    // client a visible countdown to the next deal rather than a dead pause.
    this.phaseEndsAt = new Date(Date.now() + HAND_BREAK_MS).toISOString();
    this.sequence += 1;
    await this.emitSnapshots();
    await delay(HAND_BREAK_MS);
    if (token !== this.cycleToken) return;
    this.phaseEndsAt = null;
    this.sequence += 1;
    await this.emitSnapshots();
    this.launchCycle();
  }

  private nextButtonSeat(seatedOrder: number[]): number {
    if (!seatedOrder.includes(this.buttonSeat)) return seatedOrder[0]!;
    const currentIndex = seatedOrder.indexOf(this.buttonSeat);
    return seatedOrder[(currentIndex + 1) % seatedOrder.length]!;
  }

  private async postBlind(seatNumber: number | null, amount: number): Promise<void> {
    if (!seatNumber) return;
    const seat = this.seats[seatNumber - 1]!;
    const balance = await walletService.getUserBalance(seat.userId);
    const posted = Math.min(amount, balance);
    if (posted > 0) await this.contribute(seat, seatNumber - 1, posted * COIN_SCALE);
    if (posted < amount) await this.setAllIn(seat, seatNumber - 1);
  }

  private async dealStreet(street: HoldemStreet, cardCount: number, seatedOrder: number[], token: number): Promise<void> {
    if (this.contenderSeats().length <= 1) return;
    for (let index = 0; index < cardCount; index += 1) this.board.push(this.shoe.draw());
    // Persisted so a crash after the river can be *settled* fairly from this board on restart
    // instead of refunded — see HoldemService.recoverInterruptedRounds. A crash before the full
    // board is dealt can never be resumed this way: the shoe's remaining draw order only ever
    // lived in this process's memory, and persisting it would hand a card-counting/collusion
    // tool to anyone with database access, so it deliberately is not.
    await pool.query("UPDATE game_rounds SET result_data=$2 WHERE id=$1", [this.roundId, JSON.stringify({ board: this.board, street })]);
    this.street = street;
    for (const seat of this.seats) if (seat) seat.streetContributed = 0;
    this.currentBet = 0;
    this.minRaise = this.room.min_bet * 2;
    this.actedSinceLastRaise.clear();
    await this.setPhase("DEALING", REVEAL_STEP_MS);
    await delay(REVEAL_STEP_MS);
    if (token !== this.cycleToken) return;
    if (this.activeSeats().length > 1) {
      const firstToAct = this.seatOrderFrom(this.buttonSeat + 1).find((seat) => seatedOrder.includes(seat) && this.contenderSeats().includes(seat)) ?? this.contenderSeats()[0]!;
      await this.runBettingRound(firstToAct, seatedOrder, token);
    }
  }

  private async runBettingRound(firstSeat: number, seatedOrder: number[], token: number): Promise<void> {
    if (this.contenderSeats().length <= 1) return;
    if (this.activeSeats().length <= 1) return; // Everyone left is all-in — run the board out with no more action.
    this.actingSeat = firstSeat;
    while (token === this.cycleToken) {
      const seat = this.seats[this.actingSeat! - 1];
      if (!seat || seat.folded || seat.allIn) {
        this.actingSeat = this.nextActiveSeat(this.actingSeat!, seatedOrder);
        if (this.actingSeat === null) break;
        continue;
      }
      if (this.contenderSeats().length <= 1) break;
      await this.setPhase("PLAYER_TURN", ACTION_MS);
      const seatIndexAtPrompt = this.actingSeat;
      await this.waitForTurn(ACTION_MS);
      if (token !== this.cycleToken) return;
      // A disconnected seat, or one whose slow client never answers, auto-folds (or checks for free).
      if (this.actingSeat === seatIndexAtPrompt && !this.actedSinceLastRaise.has(seatIndexAtPrompt - 1)) {
        const stillThere = this.seats[seatIndexAtPrompt - 1];
        if (stillThere && !stillThere.folded) {
          const toCall = this.currentBet - stillThere.streetContributed;
          if (toCall > 0) {
            stillThere.folded = true;
            await holdemService.markFolded(this.roundId!, stillThere.userId).catch(() => undefined);
          } else {
            this.actedSinceLastRaise.add(seatIndexAtPrompt - 1);
          }
          this.sequence += 1;
          await this.emitSnapshots();
        }
      }
      if (this.contenderSeats().length <= 1) break;
      if (this.bettingRoundClosed(seatedOrder)) break;
      this.actingSeat = this.nextActiveSeat(this.actingSeat!, seatedOrder);
      if (this.actingSeat === null) break;
    }
    this.actingSeat = null;
  }

  private bettingRoundClosed(seatedOrder: number[]): boolean {
    const inHand = seatedOrder.filter((seatNumber) => {
      const seat = this.seats[seatNumber - 1];
      return seat && !seat.folded && !seat.allIn;
    });
    if (inHand.length === 0) return true;
    return inHand.every((seatNumber) => this.actedSinceLastRaise.has(seatNumber - 1) && this.seats[seatNumber - 1]!.streetContributed === this.currentBet);
  }

  private nextActiveSeat(fromSeat: number, seatedOrder: number[]): number | null {
    const order = this.seatOrderFrom(fromSeat + 1).filter((seat) => seatedOrder.includes(seat));
    for (const seatNumber of order) {
      const seat = this.seats[seatNumber - 1];
      if (seat && !seat.folded && !seat.allIn) return seatNumber;
    }
    return null;
  }

  private async showdown(): Promise<void> {
    this.street = "showdown";
    await this.setPhase("SETTLING", SHOWDOWN_MS);
    const { balances, winners } = await holdemService.settle(this.room.id, this.roundId!, this.board, this.room.max_bet * COIN_SCALE);
    for (const [userId, balance] of balances) {
      for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("wallet.updated", { balance });
    }
    this.lastWinners = winners.map((win) => {
      const seatIndex = this.seats.findIndex((seat) => seat?.userId === win.userId);
      return {
        seatNumber: seatIndex + 1,
        username: this.usernames.get(win.userId) ?? "player",
        amount: win.amountMinor / COIN_SCALE,
        handCategory: win.handCategory,
      };
    });
    this.broadcastWinners(this.lastWinners);
    await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [this.roundId, JSON.stringify({ board: this.board, winners: this.lastWinners })]);
    await this.setPhase("RESULT", SHOWDOWN_MS);
  }
}

const HAND_LABEL: Record<string, string> = {
  high_card: "하이카드",
  pair: "원페어",
  two_pair: "투페어",
  three_of_a_kind: "트리플",
  straight: "스트레이트",
  flush: "플러시",
  full_house: "풀하우스",
  four_of_a_kind: "포카드",
  straight_flush: "스트레이트 플러시",
};

export class HoldemRoomManager {
  private actors = new Map<string, HoldemRoomActor>();

  constructor(private readonly io: GoldenServer) {}

  async initialize(): Promise<void> {
    // Must run before RoomManager.initialize() — its cross-game recovery sweep would otherwise
    // find any Hold'em hand stuck by an unclean restart and mark it ABORTED without a refund.
    const { settled, refunded } = await holdemService.recoverInterruptedRounds();
    if (settled > 0) console.log(`Settled ${settled} interrupted Hold'em hand(s) that had already reached the river`);
    if (refunded > 0) console.log(`Refunded ${refunded} interrupted Hold'em hand(s) stopped before the river`);
    const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,enabled FROM game_rooms WHERE game_type='holdem' ORDER BY min_bet");
    for (const row of result.rows) this.actors.set(row.id, new HoldemRoomActor(this.io, row));
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
  async join(socket: GoldenSocket, roomId: string): Promise<HoldemRoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor?.room.enabled) throw new Error("ROOM_NOT_FOUND");
    return actor.join(socket);
  }
  async leave(socket: GoldenSocket, roomId: string): Promise<void> { await this.actors.get(roomId)?.leave(socket); }
  async disconnect(socket: GoldenSocket): Promise<void> {
    for (const actor of this.actors.values()) if (actor.hasSocket(socket.id)) await actor.leave(socket);
  }
  async sit(userId: string, command: HoldemSeatCommand): Promise<HoldemRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.sit(userId, command);
  }
  async standUp(userId: string, roomId: string): Promise<HoldemRoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.standUp(userId);
  }
  async setReady(userId: string, roomId: string, ready: boolean): Promise<HoldemRoomSnapshot> {
    const actor = this.actors.get(roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.setReady(userId, ready);
  }
  async act(userId: string, command: HoldemActionCommand): Promise<HoldemRoomSnapshot> {
    const actor = this.actors.get(command.roomId);
    if (!actor) throw new Error("ROOM_NOT_FOUND");
    return actor.act(userId, command);
  }
}
