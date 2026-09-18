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
import { buildHoldemPots, evaluateBestHoldemHand, HOLDEM_CATEGORY_LABEL, Shoe } from "@golden/game-core";
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
  /** 이 좌석이 방금 한 행동. 판 위에 말풍선으로 띄운다. 스트리트가 바뀌면 지워진다. */
  lastAction: { action: HoldemActionCommand["action"]; amount: number } | null;
  /** 남은 타임뱅크(ms)와 다음 충전까지 받은 핸드 수. 좌석에 앉아 있는 동안 유지된다. */
  timeBankMs: number;
  handsDealt: number;
}

/** 방이 들고 있는 한 핸드의 기록. 뷰어별 스냅샷으로 옮길 때 본인 패만 붙여 준다. */
interface HandHistoryRecord {
  handNumber: number;
  board: Card[];
  showdown: boolean;
  winners: HoldemWinnerSnapshot[];
  /** 쇼다운에서 실제로 공개된 패만. 폴드 승은 비어 있다. */
  revealed: Array<{ seatNumber: number; username: string; holeCards: Card[] }>;
  /** userId → 그 핸드에서의 손익과 본인 패. */
  byUser: Map<string, { net: number; holeCards: Card[] }>;
}

const SEAT_COUNT = 6;
const BETWEEN_HANDS_MS = 4_000;
/** Idle window held open after a hand fully settles, before the next is dealt. This is the only
 *  point at which a seated player can stand up or un-ready, so it needs to be long enough to
 *  notice and click in — not just long enough to read the result. */
const HAND_BREAK_MS = 6_000;
const ACTION_MS = 20_000;
/* 타임뱅크 — 기본 시간이 다 되면 자동으로 물리는 개인 여유 시간. PokerStars 방식 그대로:
   일정 핸드마다 조금씩 차오르고 상한이 있으며, 판에 돈이 걸린 상태에서만 발동한다.
   다 쓰면 예전과 똑같이 자동 체크/폴드로 넘어간다. */
const TIME_BANK_START_MS = 15_000;
const TIME_BANK_MAX_MS = 40_000;
const TIME_BANK_STEP_MS = 5_000;
/** 이만큼 핸드를 받을 때마다 타임뱅크가 한 칸(STEP) 차오른다. */
const TIME_BANK_REFILL_HANDS = 8;
/** 방마다 들고 있는 최근 핸드 기록 수. 레일의 "지난 핸드"가 이걸 읽는다. */
const HAND_HISTORY_SIZE = 12;
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
  /** 지금 타임뱅크로 버티고 있는 좌석 번호. 화면의 타이머 링 색이 바뀐다. */
  private timeBankSeat: number | null = null;
  private handHistory: HandHistoryRecord[] = [];
  private handNumber = 0;

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
          // It's their turn right now: don't leave the table staring at a 20s countdown for a
          // player who has already gone — resolve it immediately, same as standUp() does.
          if (this.actingSeat === index + 1) this.resolveTurnEarly();
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
    this.seats[index] = { userId, username: this.usernames.get(userId) ?? "player", folded: false, allIn: false, streetContributed: 0, totalContributed: 0, holeCards: [], lastAction: null, timeBankMs: TIME_BANK_START_MS, handsDealt: 0 };
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
    // Mid-hand: leave the chips in the pot and only clear the seat once the hand settles, so
    // pot accounting never has a gap. The hand itself is folded right now (releasing the turn
    // if it was theirs) rather than left to the 20s action timer — the table shouldn't have to
    // wait out a countdown for a player who has already walked away.
    if (this.roundId && seat.totalContributed > 0 && !seat.folded) {
      if (seat.holeCards.length > 0) {
        seat.folded = true;
        await holdemService.markFolded(this.roundId, seat.userId);
        if (this.actingSeat === index + 1) this.resolveTurnEarly();
      }
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
      seat.lastAction = { action: "fold", amount: 0 };
      await holdemService.markFolded(this.roundId!, seat.userId);
      return;
    }
    if (action === "check") {
      if (toCall > 0) throw new Error("MUST_CALL_OR_FOLD");
      seat.lastAction = { action: "check", amount: 0 };
      this.actedSinceLastRaise.add(seatIndex);
      return;
    }
    const balance = await walletService.getUserBalance(seat.userId);
    if (action === "call") {
      const paid = Math.min(toCall, balance);
      if (paid > 0) await this.contribute(seat, seatIndex, paid * COIN_SCALE);
      if (paid < toCall) await this.setAllIn(seat, seatIndex);
      seat.lastAction = { action: paid < toCall ? "allin" : "call", amount: paid };
      this.actedSinceLastRaise.add(seatIndex);
      return;
    }
    if (action === "bet" || action === "raise" || action === "allin") {
      const targetTotal = action === "allin" ? seat.streetContributed + balance : rawAmount;
      if (!Number.isInteger(targetTotal) || targetTotal === undefined) throw new Error("INVALID_ACTION");
      // 콜 금액에도 못 미치는 스택으로 올인을 누른 경우. 예전에는 RAISE_TOO_SMALL 로 튕겨서,
      // 화면에는 올인 버튼이 멀쩡히 떠 있는데 누르면 "최소 레이즈보다 적습니다"가 뜨고
      // 대신 콜을 눌러야 했다. 올릴 수 없을 뿐 따라갈 수는 있으므로 숏 콜로 처리한다.
      if (action === "allin" && targetTotal <= this.currentBet) {
        if (balance > 0) await this.contribute(seat, seatIndex, balance * COIN_SCALE);
        await this.setAllIn(seat, seatIndex);
        seat.lastAction = { action: "allin", amount: balance };
        this.actedSinceLastRaise.add(seatIndex);
        return;
      }
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
      seat.lastAction = { action: increment === balance ? "allin" : action, amount: targetTotal };
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
    // 쇼다운에 실제로 패를 비교한 경우에만 공개한다. 상대가 전부 폴드해 혼자 남은 승자는
    // 패를 보이지 않는 것이 표준이고(도움말에도 그렇게 적혀 있다), 공개하면 다음 핸드를 위한
    // 정보를 공짜로 흘리는 셈이 된다. contenderSeats().length 로 구분한다.
    const showCards = this.street === "showdown" && this.contenderSeats().length > 1;
    const seats: HoldemSeatSnapshot[] = await Promise.all(this.seats.map(async (seat, index) => {
      const seatNumber = index + 1;
      if (!seat) {
        return {
          seatNumber, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0,
          folded: false, allIn: false, sittingOut: false, isButton: false, isSmallBlind: false, isBigBlind: false,
          isTurn: false, holeCards: null, dealtIn: false, handCategory: null, ready: false, lastAction: null, timeBankMs: 0,
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
        // Lets the table draw card backs for hidden opponents actually in the hand — their
        // holeCards are null above, which alone is indistinguishable from an undealt seat.
        dealtIn: seat.holeCards.length > 0,
        // Needs the >= 5 card guard, not just "has hole cards": when everyone folds preflop the
        // hand reaches showdown with an empty board, so this evaluated 2 cards and threw. That
        // exception escaped through emitSnapshots into the cycle's catch, which refunded the pot
        // and immediately re-dealt — so a seated player saw hands restart in a loop and could
        // never reach the between-hands window where standing up is allowed.
        handCategory: showCards && !seat.folded && seat.holeCards.length > 0 && seat.holeCards.length + this.board.length >= 5
          ? evaluateBestHoldemHand([...seat.holeCards, ...this.board]).category
          : null,
        ready: this.ready.has(seat.userId),
        lastAction: seat.lastAction,
        timeBankMs: Math.round(seat.timeBankMs),
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
      /** 지금 타임뱅크로 버티는 좌석(있으면). 타이머 링이 색을 바꿔 "추가 시간"임을 알린다. */
      timeBankSeat: this.timeBankSeat,
      // 지난 핸드 — 본인 패와 손익은 보는 사람 기준으로만 붙인다.
      recentHands: this.handHistory.map((record) => {
        const mine = record.byUser.get(userId);
        return {
          handNumber: record.handNumber,
          board: record.board,
          showdown: record.showdown,
          winners: record.winners,
          revealed: record.revealed,
          myHoleCards: mine?.holeCards ?? null,
          myNet: mine?.net ?? 0,
          played: Boolean(mine),
        };
      }),
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
        choiceLabel: (winner.handCategory && HOLDEM_CATEGORY_LABEL[winner.handCategory]) || "팟 획득",
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

  /** Seats still in the hand: dealt in and not folded. A seat taken mid-hand has no hole cards
   *  and is not a contender — counting it dealt out streets to a lone survivor and showed it a
   *  showdown "hand" evaluated from the board alone. */
  private contenderSeats(): number[] {
    return this.seats.map((seat, index) => (seat && !seat.folded && seat.holeCards.length > 0 ? index + 1 : null)).filter((seat): seat is number => seat !== null);
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
      seat.lastAction = null;
      // 핸드를 거듭할수록 타임뱅크가 조금씩 차오른다(상한까지). 오래 앉아 있는 사람에게
      // 결정적인 순간의 여유를 주되, 무한정 쌓이지는 않게.
      seat.handsDealt += 1;
      if (seat.handsDealt % TIME_BANK_REFILL_HANDS === 0) seat.timeBankMs = Math.min(TIME_BANK_MAX_MS, seat.timeBankMs + TIME_BANK_STEP_MS);
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
      await holdemService.recordHoleCards(this.roundId, this.room.id, seat.userId, seatNumber, seat.holeCards);
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
    // 새 스트리트 — 이번 거리의 베팅과 말풍선을 함께 비운다.
    for (const seat of this.seats) if (seat) { seat.streetContributed = 0; seat.lastAction = null; }
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
      const seatIndexAtPrompt = this.actingSeat;
      // Arm the early-resolve hook before the phase-change notification goes out, not after —
      // otherwise a disconnect landing in the gap while setPhase's snapshot emit is still in
      // flight finds turnResolve still null and falls through to the full ACTION_MS wait anyway.
      // A seat already sitting-out from earlier this hand will never answer at all; skip the
      // wait outright and fall straight into the same resolution the timeout path below does.
      const waitPromise = this.sittingOut.has(seat.userId) ? null : this.waitForTurn(ACTION_MS);
      await this.setPhase("PLAYER_TURN", ACTION_MS);
      if (waitPromise) await waitPromise;
      if (token !== this.cycleToken) return;
      // 기본 시간이 다 됐는데 아직 행동하지 않았다면 타임뱅크가 자동으로 물린다. 받을 돈이
      // 없어(체크로 끝낼 수 있어) 잃을 게 없는 자리에는 쓰지 않는다 — 자리를 비운 사람 때문에
      // 테이블 전체가 매번 추가로 기다리게 되기 때문이다.
      const bankSeat = this.seats[seatIndexAtPrompt - 1];
      const owesMoney = bankSeat ? this.currentBet - bankSeat.streetContributed > 0 : false;
      if (
        this.actingSeat === seatIndexAtPrompt && bankSeat && !bankSeat.folded && owesMoney &&
        bankSeat.timeBankMs > 0 && !this.sittingOut.has(bankSeat.userId) &&
        !this.actedSinceLastRaise.has(seatIndexAtPrompt - 1)
      ) {
        const slice = Math.min(bankSeat.timeBankMs, TIME_BANK_MAX_MS);
        this.timeBankSeat = seatIndexAtPrompt;
        const bankWait = this.waitForTurn(slice);
        await this.setPhase("PLAYER_TURN", slice);
        const startedAt = Date.now();
        await bankWait;
        bankSeat.timeBankMs = Math.max(0, bankSeat.timeBankMs - (Date.now() - startedAt));
        this.timeBankSeat = null;
        if (token !== this.cycleToken) return;
      }
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

  /**
   * 핸드가 끝날 때마다 한 줄 남긴다 — 무슨 보드였고 누가 무엇으로 가져갔는지, 그리고 각자
   * 자기 패와 손익. 여태 남는 건 DB 의 손익 한 줄뿐이라 "방금 그 핸드 뭐였지"에 답할 수
   * 없었다. 방 메모리에만 두고(최근 12핸드) 스냅샷으로 내려보낸다.
   *
   * 공개 범위는 판에서와 같다: 쇼다운에서 실제로 깐 패만 `revealed` 에 들어가고, 폴드 승은
   * 비어 있다. 본인 패는 본인 스냅샷에서만 붙는다.
   */
  private recordHand(wins: Array<{ userId: string; amountMinor: number }>): void {
    const showdown = this.contenderSeats().length > 1;
    const byUser = new Map<string, { net: number; holeCards: Card[] }>();
    for (const seat of this.seats) {
      if (!seat || seat.holeCards.length === 0) continue;
      const won = wins.find((win) => win.userId === seat.userId);
      byUser.set(seat.userId, { net: (won ? won.amountMinor / COIN_SCALE : 0) - seat.totalContributed, holeCards: [...seat.holeCards] });
    }
    this.handNumber += 1;
    this.handHistory.unshift({
      handNumber: this.handNumber,
      board: [...this.board],
      showdown,
      winners: this.lastWinners.map((win) => ({ ...win })),
      revealed: showdown
        ? this.seats.flatMap((seat, index) => (seat && !seat.folded && seat.holeCards.length > 0
          ? [{ seatNumber: index + 1, username: seat.username, holeCards: [...seat.holeCards] }]
          : []))
        : [],
      byUser,
    });
    if (this.handHistory.length > HAND_HISTORY_SIZE) this.handHistory.length = HAND_HISTORY_SIZE;
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
    this.recordHand(winners);
    this.broadcastWinners(this.lastWinners);
    await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [this.roundId, JSON.stringify({ board: this.board, winners: this.lastWinners })]);
    await this.setPhase("RESULT", SHOWDOWN_MS);
  }
}

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
