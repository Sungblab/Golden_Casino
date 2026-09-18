import type { Server, Socket } from "socket.io";
import { COIN_SCALE, type ClientToServerEvents, type GameRoom, type GameType, type HwatuCard, type RoomPhase, type ServerToClientEvents, type SutdaActionCommand, type SutdaResultRow, type SutdaRoomSnapshot, type SutdaSeatCommand, type SutdaSeatSnapshot, type SutdaStreet, type SutdaWinnerSnapshot } from "@golden/contracts";
import { evaluateSutdaHand, resolveSutdaWinners, shuffleSutdaDeck, sutdaBetOption, sutdaBetOptions, sutdaDdaengRule, type SutdaBetContext } from "@golden/game-core";
import type { AuthUser } from "../../auth/auth.js";
import { pool } from "../../database/pool.js";
import { walletService } from "../../wallet/wallet-service.js";
import { sutdaService } from "../sutda/sutda-service.js";

type GoldenServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;
type GoldenSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>;
interface RoomRow { id: string; game_type: GameType; code: string; name: string; min_bet: number; max_bet: number; enabled: boolean }
interface Seat { userId: string; username: string; folded: boolean; allIn: boolean; street: number; total: number; cards: HwatuCard[]; lastAction: { action: SutdaActionCommand["action"]; amount: number } | null }
const SEATS = 6, ACTION_MS = 20_000, DEAL_MS = 900, RESULT_MS = 6_500, BREAK_MS = 3_500;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class SutdaRoomActor {
  private phase: RoomPhase = "WAITING"; private phaseEndsAt: string | null = null; private roundId: string | null = null; private sequence = 0;
  private street: SutdaStreet | null = null; private seats: Array<Seat | null> = Array.from({ length: SEATS }, () => null); private ready = new Set<string>(); private sittingOut = new Set<string>();
  private participants = new Map<string, Set<string>>(); private names = new Map<string, string>(); private dealer = 0; private acting: number | null = null; private currentBet = 0; private acted = new Set<number>(); private requests = new Set<string>(); private turnResolve: (() => void) | null = null; private cycleRunning = false; private token = 0; private paused = false; private winners: SutdaWinnerSnapshot[] = []; private results: SutdaResultRow[] = []; private lastRake = 0; private lastDdaeng: string | null = null;
  constructor(private readonly io: GoldenServer, readonly room: RoomRow) {}
  get playerCount() { return this.participants.size; } private get seatedCount() { return this.seats.filter(Boolean).length; } private get channel() { return `sutda-room:${this.room.id}`; }
  publicRoom(): GameRoom { return { id: this.room.id, gameType: this.room.game_type, code: this.room.code, name: this.room.name, minBet: this.room.min_bet, maxBet: this.room.max_bet, playerCount: this.playerCount, phase: this.phase, enabled: this.room.enabled, paused: this.paused }; }
  setPaused(value: boolean) { this.paused = value; if (!value) this.launch(); } hasSocket(id: string) { return [...this.participants.values()].some((ids) => ids.has(id)); } hasParticipant(userId: string) { return this.participants.has(userId); } participantUserIds(): string[] { return [...this.participants.keys()]; }
  async join(socket: GoldenSocket): Promise<SutdaRoomSnapshot> { const user = socket.data.user; const ids = this.participants.get(user.id) ?? new Set<string>(); ids.add(socket.id); this.participants.set(user.id, ids); this.names.set(user.id, user.nickname); this.sittingOut.delete(user.id); await socket.join(this.channel); this.presence(); return this.snapshot(user.id); }
  async leave(socket: GoldenSocket) {
    const userId = socket.data.user.id; const ids = this.participants.get(userId); ids?.delete(socket.id);
    if (!ids?.size) {
      this.participants.delete(userId);
      const index = this.seats.findIndex((seat) => seat?.userId === userId);
      // 판이 돌고 있지 않고 걸린 돈도 없으면 자리를 바로 비운다. v1 은 여기서도 sittingOut 으로만
      // 표시해 좌석을 붙들었고, 준비를 누르지 않은 채 창을 닫은 사람 하나가 allReady() 를 영원히
      // 막아 테이블 전체가 잠겼다.
      if (index >= 0 && !this.roundId) { this.seats[index] = null; this.ready.delete(userId); this.sequence++; await this.emit(); }
      else { this.sittingOut.add(userId); if (index >= 0 && this.acting === index + 1) this.turnResolve?.(); }
    }
    await socket.leave(this.channel); this.presence();
  }
  async sit(userId: string, input: SutdaSeatCommand) { if (!this.hasParticipant(userId)) throw new Error("ROOM_JOIN_REQUIRED"); if (this.seats.some((seat) => seat?.userId === userId)) throw new Error("ALREADY_SEATED"); const index = input.seatNumber - 1; if (index < 0 || index >= SEATS || this.seats[index]) throw new Error("SEAT_TAKEN"); if (await walletService.getUserBalance(userId) < this.room.min_bet * 2) throw new Error("INSUFFICIENT_BALANCE"); this.seats[index] = { userId, username: this.names.get(userId) ?? "player", folded: false, allIn: false, street: 0, total: 0, cards: [], lastAction: null }; this.sequence++; await this.emit(); return this.snapshot(userId); }
  async standUp(userId: string) {
    const index = this.seats.findIndex((seat) => seat?.userId === userId);
    if (index < 0) throw new Error("NOT_SEATED");
    const seat = this.seats[index]!;
    if (this.roundId) {
      // Leaving mid-hand is a 다이: fold on the spot (and release the turn if it was theirs) instead of
      // parking the seat until its 20s timer folds it — the other players shouldn't wait out a
      // countdown for someone who has already left. The seat itself is freed when the hand resets.
      if (seat.cards.length > 0 && !seat.folded) {
        seat.folded = true;
        await sutdaService.markFolded(this.roundId, seat.userId);
        if (this.acting === index + 1) this.turnResolve?.();
      }
      this.sittingOut.add(userId);
    } else this.seats[index] = null;
    this.ready.delete(userId);
    this.sequence++;
    await this.emit();
    return this.snapshot(userId);
  }
  async setReady(userId: string, value: boolean) { if (!this.seats.some((seat) => seat?.userId === userId)) throw new Error("NOT_SEATED"); value ? this.ready.add(userId) : this.ready.delete(userId); this.sequence++; await this.emit(); if (value) this.launch(); return this.snapshot(userId); }
  async act(userId: string, input: SutdaActionCommand) { if (this.requests.has(input.requestId)) return this.snapshot(userId); this.requests.add(input.requestId); let done = false; try { const index = this.seats.findIndex((seat) => seat?.userId === userId); if (index < 0) throw new Error("NOT_SEATED"); if (this.phase !== "PLAYER_TURN" || input.roundId !== this.roundId || this.acting !== index + 1) throw new Error("NOT_YOUR_TURN"); await this.apply(index, input.action); done = true; this.sequence++; await this.emit(); this.turnResolve?.(); return this.snapshot(userId); } finally { if (!done) this.requests.delete(input.requestId); } }
  /** 이 좌석이 지금 낼 수 있는 금액을 정하는 상태. game-core 의 사이징 함수에 그대로 넘긴다. */
  private async betContext(index: number): Promise<SutdaBetContext> {
    const seat = this.seats[index]!;
    return {
      minBet: this.room.min_bet, maxBet: this.room.max_bet,
      pot: this.seats.reduce((sum, s) => sum + (s?.total ?? 0), 0),
      currentBet: this.currentBet, seatStreet: seat.street, seatTotal: seat.total,
      balance: await walletService.getUserBalance(seat.userId),
    };
  }
  /**
   * 모든 베팅 선택은 game-core 의 sutdaBetOptions 한 곳에서 금액이 나온다 — 클라이언트가 버튼에
   * 찍는 숫자와 서버가 실제로 걷는 금액이 같은 함수에서 나오므로 어긋날 수 없다.
   * 올인은 콜 금액에 못 미치는 잔액으로도 따라갈 수 있게 해 준다(숏 콜). 그래서 "돈이 모자라면
   * 다이밖에 못 한다"는 막다른 길이 없어지고, 대신 사이드팟이 생긴다.
   */
  private async apply(index: number, action: SutdaActionCommand["action"]) {
    const seat = this.seats[index]!;
    const toCall = Math.max(0, this.currentBet - seat.street);
    if (action === "die") {
      // 혼자 남은 사람이 죽으면 승자가 없어 정산이 0으로 나눠진다. 그 경우는 체크로 돌린다.
      if (this.active().length <= 1) { seat.lastAction = { action: "check", amount: 0 }; this.acted.add(index); return; }
      seat.folded = true; seat.lastAction = { action: "die", amount: 0 };
      await sutdaService.markFolded(this.roundId!, seat.userId); return;
    }
    if (action === "check") { if (toCall) throw new Error("MUST_CALL_OR_DIE"); seat.lastAction = { action: "check", amount: 0 }; this.acted.add(index); return; }

    const option = sutdaBetOption(await this.betContext(index), action);
    if (!option) throw new Error("NOT_YOUR_TURN");
    if (!option.enabled) throw new Error(option.reason === "한도 도달" ? "TABLE_LIMIT_REACHED" : "INSUFFICIENT_BALANCE");
    if (option.amount > 0) await this.contribute(index, option.amount);
    if (option.allIn) seat.allIn = true;
    seat.lastAction = { action, amount: option.amount };
    if (option.raiseBy > 0) { this.currentBet = seat.street; this.acted = new Set([index]); }
    else this.acted.add(index);
  }
  private async contribute(index: number, coins: number) { const seat = this.seats[index]!; if (seat.total + coins > this.room.max_bet) throw new Error("TABLE_LIMIT_REACHED"); const client = await pool.connect(); try { await client.query("BEGIN"); await sutdaService.contribute(client, { requestId: `${this.roundId}:${seat.userId}:${seat.total}`, userId: seat.userId, roomId: this.room.id, roundId: this.roundId!, seatNumber: index + 1, amountMinor: coins * COIN_SCALE }); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } seat.street += coins; seat.total += coins; }
  async snapshot(userId: string): Promise<SutdaRoomSnapshot> { const mine = this.seats.findIndex((seat) => seat?.userId === userId); const reveal = this.street === "showdown"; const seats: SutdaSeatSnapshot[] = await Promise.all(this.seats.map(async (seat, index) => !seat ? ({ seatNumber: index + 1, userId: null, username: null, stack: 0, streetContributed: 0, totalContributed: 0, folded: false, sittingOut: false, isDealer: false, isTurn: false, cards: null, cardCount: 0, handLabel: null, ready: false, allIn: false, lastAction: null }) : ({ seatNumber: index + 1, userId: seat.userId, username: seat.username, stack: await walletService.getUserBalance(seat.userId), streetContributed: seat.street, totalContributed: seat.total, folded: seat.folded, sittingOut: this.sittingOut.has(seat.userId), isDealer: this.dealer === index + 1, isTurn: this.acting === index + 1, cards: seat.userId === userId || (reveal && !seat.folded) ? (seat.cards.length ? seat.cards : null) : null, cardCount: seat.cards.length, handLabel: seat.cards.length === 2 && (seat.userId === userId || reveal) ? evaluateSutdaHand(seat.cards).label : null, ready: this.ready.has(seat.userId), allIn: seat.allIn, lastAction: seat.lastAction }))); const me = mine >= 0 ? this.seats[mine] : null; return { room: this.publicRoom(), roundId: this.roundId, sequence: this.sequence, phaseEndsAt: this.phaseEndsAt, street: this.street, pot: { amount: this.seats.reduce((sum, seat) => sum + (seat?.total ?? 0), 0) }, seats, mySeatNumber: mine < 0 ? null : mine + 1, toCall: me ? Math.max(0, this.currentBet - me.street) : 0, actingSeat: this.phase === "PLAYER_TURN" ? this.acting : null, betOptions: me && this.phase === "PLAYER_TURN" && this.acting === mine + 1 && !me.folded && !me.allIn ? sutdaBetOptions(await this.betContext(mine)) : [], lastWinners: this.winners, lastResults: this.results, lastRake: this.lastRake, lastDdaeng: this.lastDdaeng, walletBalance: await walletService.getUserBalance(userId) }; }
  private async emit() { for (const [userId, sockets] of this.participants) { const shot = await this.snapshot(userId); for (const id of sockets) this.io.to(id).emit("sutda.snapshot", shot); } }
  private presence() { this.io.emit("room.presence", { roomId: this.room.id, playerCount: this.playerCount }); }
  private async phaseTo(phase: RoomPhase, ms?: number) { this.phase = phase; this.phaseEndsAt = ms ? new Date(Date.now() + ms).toISOString() : null; this.sequence++; await this.emit(); }
  private allReady() { return this.seats.every((seat) => !seat || this.ready.has(seat.userId)); }
  private launch() { if (this.cycleRunning || this.paused || this.phase !== "WAITING" || this.seatedCount < 2 || !this.allReady()) return; this.cycleRunning = true; void this.play().catch(async (error) => { console.error(`Sutda room ${this.room.code} failed`, error); try { if (this.roundId) await sutdaService.refundRound(this.roundId, this.room.id); } catch (refundError) { console.error(`Sutda room ${this.room.code} refund failed`, refundError); } finally { this.reset(); await this.emit(); } }).finally(() => { this.cycleRunning = false; this.launch(); }); }
  /** 판이 끝난 뒤 다음 판을 받을 수 있는 상태로 되돌린다.
   *  v1 은 여기서 `ready` 를 통째로 비워 매 판 전원이 준비를 다시 눌러야 했다 — 화면의
   *  "다음 판에 자동으로 참여합니다" 와도 어긋났고, 상용 섯다처럼 판이 이어지지도 않았다.
   *  이제 준비는 앉아 있는 동안 유지되고, 자리를 뜬 사람만 정리된다. */
  private reset() {
    this.phase = "WAITING"; this.phaseEndsAt = null; this.roundId = null; this.street = null; this.acting = null; this.currentBet = 0;
    this.acted.clear(); this.requests.clear();
    for (const id of this.sittingOut) { const index = this.seats.findIndex((seat) => seat?.userId === id); if (index >= 0) { this.seats[index] = null; this.ready.delete(id); } }
    this.sittingOut.clear();
    for (const seat of this.seats) if (seat) { seat.allIn = false; seat.folded = false; seat.street = 0; }
  }
  /** Seats still contesting this hand: dealt in and not folded. A player who sits down mid-hand
   *  has no cards yet and must not count — it used to, which kept the betting loop from ever
   *  closing (its "everyone acted" tally could never reach the inflated active count) and then
   *  crashed the showdown evaluating an empty hand. */
  private active() { return this.seats.map((seat, index) => seat && !seat.folded && seat.cards.length > 0 ? index + 1 : null).filter((value): value is number => value !== null); }
  private order(start: number) { const result: number[] = []; for (let i = 0; i < SEATS; i++) { const n = ((start - 1 + i) % SEATS) + 1; if (this.seats[n - 1] && !this.sittingOut.has(this.seats[n - 1]!.userId)) result.push(n); } return result; }
  private async play() { const token = ++this.token; const eligible = this.seats.map((seat, index) => seat && !this.sittingOut.has(seat.userId) ? index + 1 : null).filter((value): value is number => value !== null); if (eligible.length < 2) return; for (const number of eligible) { const seat = this.seats[number - 1]!; if (await walletService.getUserBalance(seat.userId) < this.room.min_bet * 2) this.sittingOut.add(seat.userId); } const order = this.order(this.dealer + 1); if (order.length < 2) return; this.dealer = order[0]!; for (const number of order) { const seat = this.seats[number - 1]!; seat.folded = false; seat.allIn = false; seat.street = 0; seat.total = 0; seat.cards = []; seat.lastAction = null; } const next = await pool.query<{ next_number: string }>("SELECT COALESCE(MAX(round_number),0)+1 AS next_number FROM game_rounds WHERE room_id=$1", [this.room.id]); const created = await pool.query<{ id: string }>("INSERT INTO game_rounds (room_id,round_number,phase,rules_version) VALUES ($1,$2,'DEALING','sutda-v1') RETURNING id", [this.room.id, Number(next.rows[0]!.next_number)]); this.roundId = created.rows[0]!.id; this.winners = []; this.results = []; this.lastRake = 0; this.lastDdaeng = null; for (const number of order) await this.contribute(number - 1, this.room.min_bet); this.currentBet = this.room.min_bet; const deck = shuffleSutdaDeck(); for (const number of order) this.seats[number - 1]!.cards.push(deck.pop()!); this.street = "first"; await this.phaseTo("DEALING", DEAL_MS); await delay(DEAL_MS); await this.betting(order[1] ?? order[0]!, order, token); if (token !== this.token || this.active().length <= 1) { // Win-by-fold on the FIRST street. This must still run the same RESULT-wait/reset tail as
    // the normal path below: an early `return this.showdown()` left the phase parked at RESULT
    // forever — launch() only fires from WAITING, so the whole table bricked until a restart.
    await this.showdown(); await delay(RESULT_MS); this.reset(); await this.phaseTo("WAITING", BREAK_MS); await delay(BREAK_MS); return; } for (const number of order) if (!this.seats[number - 1]!.folded) { this.seats[number - 1]!.cards.push(deck.pop()!); await sutdaService.recordCards(this.roundId, this.seats[number - 1]!.userId, this.seats[number - 1]!.cards); } for (const seat of this.seats) if (seat) { seat.street = 0; seat.lastAction = null; } this.currentBet = 0; this.acted.clear(); this.street = "final"; await this.phaseTo("DEALING", DEAL_MS); await delay(DEAL_MS); await this.betting(order[1] ?? order[0]!, order, token); await this.showdown(); await delay(RESULT_MS); this.reset(); await this.phaseTo("WAITING", BREAK_MS); await delay(BREAK_MS); }
  /** 아직 선택할 수 있는 좌석 — 죽지 않았고 올인도 아닌 사람. 올인한 사람은 승부에는 남지만
   *  더 낼 돈이 없으므로 베팅 순번에서 빠진다. */
  private canAct() { return this.seats.map((seat, index) => seat && !seat.folded && !seat.allIn && seat.cards.length > 0 ? index + 1 : null).filter((value): value is number => value !== null); }
  private async betting(first: number, order: number[], token: number) {
    this.street = this.street ?? "first";
    this.acting = this.seats[first - 1] && !this.seats[first - 1]!.folded && !this.seats[first - 1]!.allIn ? first : this.next(first, order);
    while (token === this.token && this.active().length > 1 && this.canAct().length > 0) {
      const seat = this.seats[this.acting - 1]!;
      if (seat.folded || seat.allIn) { this.acting = this.next(this.acting, order); continue; }
      const prompted = this.acting;
      const waitPromise = this.sittingOut.has(seat.userId) ? null : new Promise<void>((resolve) => { const timer = setTimeout(resolve, ACTION_MS); this.turnResolve = () => { clearTimeout(timer); resolve(); }; });
      await this.phaseTo("PLAYER_TURN", ACTION_MS);
      if (waitPromise) await waitPromise;
      this.turnResolve = null;
      const late = this.seats[prompted - 1]!;
      if (!late.folded && !late.allIn && !this.acted.has(prompted - 1) && this.acting === prompted) {
        // 시간이 다 되면 낼 돈이 있으면 죽고, 없으면 그냥 넘긴다. 마지막 한 명은 죽일 수 없다.
        if (this.currentBet > late.street && this.active().length > 1) { late.folded = true; late.lastAction = { action: "die", amount: 0 }; await sutdaService.markFolded(this.roundId!, late.userId); }
        else { late.lastAction = { action: "check", amount: 0 }; this.acted.add(prompted - 1); }
        this.sequence++; await this.emit();
      }
      if (this.active().length <= 1) break;
      // 올인한 좌석은 기준 금액을 맞출 수 없으므로 '전원이 맞췄는가' 판정에서 제외한다.
      const pending = this.canAct().filter((n) => !this.acted.has(n - 1) || this.seats[n - 1]!.street !== this.currentBet);
      if (pending.length === 0) break;
      this.acting = this.next(prompted, order);
    }
    this.acting = null;
  }
  private next(from: number, order: number[]) { const index = order.indexOf(from); for (let step = 1; step <= order.length; step++) { const number = order[(index + step) % order.length]!; const seat = this.seats[number - 1]; if (seat && !seat.folded && !seat.allIn) return number; } return from; }
  private async showdown() {
    if (!this.roundId) return;
    this.street = "showdown";
    const seated = this.seats.map((seat, index) => (seat && seat.cards.length > 0 ? { seat, seatNumber: index + 1 } : null)).filter((item): item is NonNullable<typeof item> => item !== null);
    const active = seated.filter((item) => !item.seat.folded).map((item) => ({ userId: item.seat.userId, cards: item.seat.cards, seatNumber: item.seatNumber }));
    // A single survivor always just wins outright — win-by-fold at either street. Routing this
    // through resolveSutdaWinners would let a lone "멍텅구리 구사" hand force a redeal with no one
    // left to redeal against, mislabeling a clean win and waiving the house rake.
    const earlyWin = active.length === 1;
    const result = earlyWin
      ? { winnerIds: [active[0]!.userId], handByUser: new Map<string, ReturnType<typeof evaluateSutdaHand>>(), redeal: false }
      : resolveSutdaWinners(active);

    const totalMinor = seated.reduce((sum, item) => sum + item.seat.total, 0) * COIN_SCALE;
    const potPayouts = new Map<string, number>();
    const outcomes = new Map<string, "win" | "lose" | "push">();
    const ddaengMoves: Array<{ fromUserId: string; toUserId: string; amountMinor: number }> = [];
    let rakeMinor = 0;
    let ddaengLabel: string | null = null;
    let winnerIds: string[] = [];

    if (result.redeal) {
      // 멍텅구리 구사 — 판이 무효다. 죽은 사람까지 포함해 각자 낸 돈을 그대로 돌려준다.
      // (v1 은 살아남은 사람끼리 팟을 n분의 1로 나눠 가져서, 죽은 사람 삥이 남에게 흘러갔다.)
      for (const item of seated) { potPayouts.set(item.seat.userId, item.seat.total * COIN_SCALE); outcomes.set(item.seat.userId, "push"); }
      winnerIds = [];
    } else {
      // 사이드팟: 기여액 층마다 잘라서, 그 층까지 낸 사람들 중 가장 센 패가 가져간다.
      // 올인으로 적게 낸 사람이 자기가 낸 만큼만 가져가고 나머지는 남은 사람들끼리 다툰다.
      const effective = new Map<string, number>();
      for (const entry of active) effective.set(entry.userId, result.winnerIds.includes(entry.userId) ? Number.MAX_SAFE_INTEGER : (result.handByUser.get(entry.userId)?.rank ?? 0));
      const levels = [...new Set(seated.map((item) => item.seat.total))].filter((level) => level > 0).sort((a, b) => a - b);
      let previous = 0;
      for (const level of levels) {
        const contributors = seated.filter((item) => item.seat.total >= level);
        const sliceMinor = (level - previous) * contributors.length * COIN_SCALE;
        previous = level;
        if (sliceMinor <= 0) continue;
        const eligible = contributors.filter((item) => !item.seat.folded);
        if (eligible.length === 0) { for (const item of contributors) potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + Math.floor(sliceMinor / contributors.length)); continue; }
        const sliceRake = sutdaService.rakeFor(sliceMinor, this.room.max_bet);
        rakeMinor += sliceRake;
        const best = Math.max(...eligible.map((item) => effective.get(item.seat.userId) ?? 0));
        const takers = eligible.filter((item) => (effective.get(item.seat.userId) ?? 0) === best);
        const share = Math.floor((sliceMinor - sliceRake) / takers.length);
        takers.forEach((item, index) => {
          potPayouts.set(item.seat.userId, (potPayouts.get(item.seat.userId) ?? 0) + share + (index === 0 ? sliceMinor - sliceRake - share * takers.length : 0));
          if (!winnerIds.includes(item.seat.userId)) winnerIds.push(item.seat.userId);
        });
      }
      for (const item of seated) outcomes.set(item.seat.userId, winnerIds.includes(item.seat.userId) ? "win" : "lose");

      // 땡값 — 땡·광땡으로 이겼을 때 끝까지 따라온 아랫패에게 따로 더 받는다. 올인해서
      // 지갑이 빈 사람에게는 물리지 않는다(피망 규칙).
      const topWinner = winnerIds[0];
      const topHand = topWinner ? result.handByUser.get(topWinner) : undefined;
      const rule = !earlyWin && topHand ? sutdaDdaengRule(topHand) : null;
      if (rule && topWinner) {
        ddaengLabel = rule.label;
        for (const entry of active) {
          if (entry.userId === topWinner || winnerIds.includes(entry.userId)) continue;
          const hand = result.handByUser.get(entry.userId);
          if (!hand || hand.rank > rule.payerMaxRank) continue;
          const payerSeat = this.seats[entry.seatNumber - 1]!;
          const balance = await walletService.getUserBalance(entry.userId);
          const headroom = Math.max(0, this.room.max_bet - payerSeat.total);
          const amount = Math.min(Math.floor(payerSeat.total * rule.rate), headroom, balance);
          if (amount > 0) ddaengMoves.push({ fromUserId: entry.userId, toUserId: topWinner, amountMinor: amount * COIN_SCALE });
        }
      }
    }

    const settled = await sutdaService.settle(this.room.id, this.roundId, { rakeMinor, potPayouts, ddaeng: ddaengMoves, outcomes });
    this.lastRake = Math.round(rakeMinor / COIN_SCALE);
    this.lastDdaeng = ddaengLabel;
    const label = (userId: string) => earlyWin ? "상대 전원 다이" : result.redeal ? "멍텅구리 구사 · 재경기" : result.handByUser.get(userId)?.label ?? "";
    this.winners = seated.filter((item) => winnerIds.includes(item.seat.userId)).map((item) => ({
      seatNumber: item.seatNumber, username: item.seat.username,
      amount: Math.max(0, Math.round(((potPayouts.get(item.seat.userId) ?? 0) + (settled.ddaengByUser.get(item.seat.userId) ?? 0)) / COIN_SCALE)),
      handLabel: label(item.seat.userId),
    }));
    // 게임결과 — 전원의 손익을 한 줄씩. 상용 섯다가 판마다 보여주는 그 패널이다.
    this.results = seated.map((item) => {
      const paid = Math.round((potPayouts.get(item.seat.userId) ?? 0) / COIN_SCALE);
      const ddaeng = Math.round((settled.ddaengByUser.get(item.seat.userId) ?? 0) / COIN_SCALE);
      return {
        seatNumber: item.seatNumber, username: item.seat.username,
        handLabel: item.seat.folded ? null : result.redeal ? "재경기" : evaluateSutdaHand(item.seat.cards).label,
        contributed: item.seat.total, payout: paid, ddaeng,
        net: paid + ddaeng - item.seat.total,
        outcome: outcomes.get(item.seat.userId) ?? "lose",
      };
    }).sort((a, b) => b.net - a.net);
    await pool.query("UPDATE game_rounds SET phase='RESULT',result_data=$2,settled_at=now() WHERE id=$1", [this.roundId, JSON.stringify({ winners: this.winners, results: this.results, redeal: result.redeal, rake: this.lastRake })]);
    await this.phaseTo("RESULT", RESULT_MS);
    for (const [userId, balance] of settled.balances) for (const socketId of this.participants.get(userId) ?? []) this.io.to(socketId).emit("wallet.updated", { balance });
  }
}

export class SutdaRoomManager { private actors = new Map<string, SutdaRoomActor>(); constructor(private readonly io: GoldenServer) {} async initialize() { const recovered = await sutdaService.recoverInterruptedRounds(); if (recovered) console.warn(`Refunded ${recovered} interrupted Sutda round(s)`); const result = await pool.query<RoomRow>("SELECT id,game_type,code,name,min_bet,max_bet,enabled FROM game_rooms WHERE game_type='sutda' ORDER BY min_bet"); for (const row of result.rows) this.actors.set(row.id, new SutdaRoomActor(this.io, row)); } listRooms() { return [...this.actors.values()].map((actor) => actor.publicRoom()); } isParticipant(userId: string, roomId: string) { return this.actors.get(roomId)?.hasParticipant(userId) ?? false; } participantUserIds(roomId: string): string[] | null { return this.actors.get(roomId)?.participantUserIds() ?? null; } setPaused(roomId: string, value: boolean) { const actor = this.actors.get(roomId); if (!actor) return false; actor.setPaused(value); return true; } async join(socket: GoldenSocket, roomId: string) { const actor = this.actors.get(roomId); if (!actor?.room.enabled) throw new Error("ROOM_NOT_FOUND"); return actor.join(socket); } async leave(socket: GoldenSocket, roomId: string) { await this.actors.get(roomId)?.leave(socket); } async disconnect(socket: GoldenSocket) { for (const actor of this.actors.values()) if (actor.hasSocket(socket.id)) await actor.leave(socket); } async sit(userId: string, input: SutdaSeatCommand) { const actor = this.actors.get(input.roomId); if (!actor) throw new Error("ROOM_NOT_FOUND"); return actor.sit(userId, input); } async standUp(userId: string, roomId: string) { const actor = this.actors.get(roomId); if (!actor) throw new Error("ROOM_NOT_FOUND"); return actor.standUp(userId); } async setReady(userId: string, roomId: string, ready: boolean) { const actor = this.actors.get(roomId); if (!actor) throw new Error("ROOM_NOT_FOUND"); return actor.setReady(userId, ready); } async act(userId: string, input: SutdaActionCommand) { const actor = this.actors.get(input.roomId); if (!actor) throw new Error("ROOM_NOT_FOUND"); return actor.act(userId, input); } }
