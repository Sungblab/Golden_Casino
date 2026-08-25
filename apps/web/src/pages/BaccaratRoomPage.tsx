import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { AnimatePresence, motion } from "motion/react";
import { Repeat2, Undo2 } from "lucide-react";
import type { BaccaratBetChoice, Card, ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from "@golden/contracts";
import { handScore, payoutForBaccaratBet, type BaccaratResult } from "@golden/game-core/baccarat";
import { lightningFee, payoutForLightningBaccaratBet } from "@golden/game-core/lightning";
import { API_URL } from "../api";
import { GameShell } from "../components/GameShell";
import { Brand } from "../components/Brand";
import { PlayingCard } from "../components/PlayingCard";
import { CardFace } from "../components/CardFace";
import { BetZone } from "../components/BetZone";
import { BigRoad } from "../components/BigRoad";
import { DerivedRoads } from "../components/DerivedRoads";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { playSound } from "../lib/sound";
import { CHIP_TIER_COLORS, chipTier, chipValuesForRoom, maximumAdditionalBet } from "../lib/betting";

/**
 * Reveal pacing. The whole sequence has to finish inside the server's DEALING window
 * (DEALING_MS in room-manager.ts) or the result banner is still animating in when the
 * table has already settled and moved on. Worst case is six cards — two third-card
 * draws — so budget against that:
 *
 *   5 × DEAL_STEP_MS + DEAL_LEAD_MS + THIRD_CARD_PAUSE_MS  ≤  DEALING_MS
 *   5 × 430          + 140          + 520                  =  2_810ms  ≤ 3_400ms
 */
const DEAL_STEP_MS = 430;
/** Beat before the first card lands, so the deal reads as deliberate rather than instant. */
const DEAL_LEAD_MS = 140;
/** A natural-table pause before either side receives a third card. */
const THIRD_CARD_PAUSE_MS = 520;
const BET_CHOICES: BaccaratBetChoice[] = ["player_pair", "player", "tie", "banker", "banker_pair"];
/** Must match room-manager.ts's BETTING_MS (12_000ms) — drives the countdown ring. */
const BETTING_SECONDS = 12;
/**
 * How long the settlement notice stays up. Must be shorter than the server's RESULT phase
 * (RESULT_MS, 4_000ms) or a win notice is still on screen during the next round's betting.
 */
const RESULT_NOTICE_MS = 2_600;
/** Circumference of the countdown ring's r=26 circle (2πr), used for its stroke-dashoffset animation. */
const TIMER_RING = 163.4;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const prefersLightweightChipEffects = (): boolean =>
  prefersReducedMotion() ||
  (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches);

interface FlyingChip {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  value: number;
}

interface BurstItem {
  id: string;
  x: number;
  y: number;
}

function Burst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 12;
        const distance = i % 2 === 0 ? 46 : 34;
        return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
      }),
    [],
  );
  return (
    <div className="win-burst" style={{ left: x, top: y }}>
      {particles.map((particle, i) => (
        <motion.span
          key={i}
          className="win-burst-dot"
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: particle.dx, y: particle.dy, opacity: 0, scale: 0.3 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          onAnimationComplete={i === 0 ? onDone : undefined}
        />
      ))}
    </div>
  );
}

export function BaccaratRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [chip, setChip] = useState(1);
  const [chipMenuOpen, setChipMenuOpen] = useState(false);
  const [roadPrediction, setRoadPrediction] = useState<BaccaratResult["result"] | null>(null);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [visiblePlayerCards, setVisiblePlayerCards] = useState<Card[]>([]);
  const [visibleBankerCards, setVisibleBankerCards] = useState<Card[]>([]);
  const previousPhase = useRef<RoomSnapshot["room"]["phase"] | null>(null);
  const lastBets = useRef<Partial<RoomSnapshot["myBets"]>>({});
  const roundBetsRef = useRef<Partial<RoomSnapshot["myBets"]>>({});
  const dealtRoundRef = useRef<string | null>(null);
  const dealTimers = useRef<number[]>([]);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(() => io(API_URL, { auth: { token }, autoConnect: false }), [token]);

  const shellRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const zoneRefs = useRef<Record<BaccaratBetChoice, HTMLButtonElement | null>>({} as Record<BaccaratBetChoice, HTMLButtonElement | null>);
  const handRefs = useRef<Record<"player" | "banker", HTMLElement | null>>({ player: null, banker: null });
  const effectIdRef = useRef(0);
  const burstRoundRef = useRef<string | null>(null);
  const noticeRoundRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [flyingChips, setFlyingChips] = useState<FlyingChip[]>([]);
  const [bursts, setBursts] = useState<BurstItem[]>([]);
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const nextEffectId = (prefix: string): string => {
    effectIdRef.current += 1;
    return `${prefix}-${effectIdRef.current}`;
  };

  const spawnFlyingChip = (choiceKey: BaccaratBetChoice, amount: number, chipValue: number): void => {
    if (prefersLightweightChipEffects()) return;
    const overlay = overlayRef.current;
    const from = chipRefs.current[chipValue];
    const to = zoneRefs.current[choiceKey];
    if (!overlay || !from || !to) return;
    const overlayRect = overlay.getBoundingClientRect();
    const fromRect = from.getBoundingClientRect();
    const toRect = to.getBoundingClientRect();
    setFlyingChips((value) => [
      ...value,
      {
        id: nextEffectId("chip"),
        fromX: fromRect.left + fromRect.width / 2 - overlayRect.left,
        fromY: fromRect.top + fromRect.height / 2 - overlayRect.top,
        toX: toRect.left + toRect.width / 2 - overlayRect.left,
        toY: toRect.top + toRect.height / 2 - overlayRect.top,
        color: CHIP_TIER_COLORS[chipTier(chipValue)]!,
        value: amount,
      },
    ]);
  };

  const spawnBurst = (el: HTMLElement | null): void => {
    if (prefersReducedMotion()) return;
    const overlay = overlayRef.current;
    if (!overlay || !el) return;
    const overlayRect = overlay.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setBursts((value) => [
      ...value,
      { id: nextEffectId("burst"), x: rect.left + rect.width / 2 - overlayRect.left, y: rect.top + rect.height / 2 - overlayRect.top },
    ]);
  };

  const toggleFullscreen = async (): Promise<void> => {
    if (!shellRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shellRef.current.requestFullscreen();
  };

  useEffect(() => {
    const acceptSnapshot = (next: RoomSnapshot) => setSnapshot((current) => (!current || next.sequence >= current.sequence ? next : current));
    const handleSnapshot = (next: RoomSnapshot) => acceptSnapshot(next);
    const handleWallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const handleConnect = () => socket.emit("room.join", { roomId }, (ack) => (ack.ok ? acceptSnapshot(ack.data) : setMessage(ack.error)));
    const handleConnectError = (error: Error) => {
      if (error.message === "UNAUTHORIZED") window.dispatchEvent(new Event("golden:session-expired"));
      else setMessage("게임 서버에 연결할 수 없습니다.");
    };
    const handleNotification = ({ message: nextMessage }: { message: string }) => setMessage(nextMessage);
    socket.on("room.snapshot", handleSnapshot);
    socket.on("wallet.updated", handleWallet);
    socket.on("notification", handleNotification);
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.connect();
    return () => {
      socket.emit("room.leave", { roomId }, () => undefined);
      socket.off("room.snapshot", handleSnapshot);
      socket.off("wallet.updated", handleWallet);
      socket.off("notification", handleNotification);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.disconnect();
      for (const timer of dealTimers.current) window.clearTimeout(timer);
    };
  }, [roomId, socket]);

  useEffect(() => {
    const update = () => setSeconds(snapshot?.phaseEndsAt ? Math.max(0, Math.ceil((new Date(snapshot.phaseEndsAt).getTime() - Date.now()) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [snapshot?.phaseEndsAt]);

  // Keep the selected chip inside this table's limit (rooms can have different maxBet values).
  useEffect(() => {
    if (!snapshot) return;
    const allowed = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => (allowed.includes(current) ? current : allowed[0]!));
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]);

  // Snapshot this round's bets so "repeat bet" has something to replay next round.
  useEffect(() => {
    if (!snapshot) return;
    const phase = snapshot.room.phase;
    if (phase === previousPhase.current) return;
    previousPhase.current = phase;
    if (phase === "BETTING") playSound("chip");
    if (phase === "LOCKED") {
      const placed = Object.fromEntries(Object.entries(snapshot.myBets).filter(([, amount]) => amount > 0));
      roundBetsRef.current = placed;
      if (Object.keys(placed).length > 0) lastBets.current = placed;
    }
  }, [snapshot]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || noticeRoundRef.current === snapshot.roundId) return;
    const fullyRevealed = visiblePlayerCards.length === snapshot.playerCards.length && visibleBankerCards.length === snapshot.bankerCards.length;
    if (!fullyRevealed) return;
    noticeRoundRef.current = snapshot.roundId;
    const settledBets = roundBetsRef.current;
    const totalBet = Object.values(settledBets).reduce((sum, amount) => sum + (amount ?? 0), 0);
    if (totalBet <= 0) return;

    const roundResult: BaccaratResult = {
      playerCards: snapshot.playerCards,
      bankerCards: snapshot.bankerCards,
      playerScore: snapshot.playerScore ?? handScore(snapshot.playerCards),
      bankerScore: snapshot.bankerScore ?? handScore(snapshot.bankerCards),
      result: snapshot.result,
      playerPair: snapshot.playerPair,
      bankerPair: snapshot.bankerPair,
    };
    const lightningCards = snapshot.lightningCards ?? [];
    const payout = Object.entries(settledBets).reduce(
      (sum, [choice, amount]) => sum + (lightningCards.length > 0
        ? payoutForLightningBaccaratBet(choice as BaccaratBetChoice, roundResult, lightningCards, amount)
        : payoutForBaccaratBet(choice as BaccaratBetChoice, roundResult, amount)),
      0,
    );
    const fee = snapshot.lightningFeePercent === 20 ? lightningFee(totalBet, 20) : 0;
    const net = payout - totalBet - fee;
    // On a win, show the total coins credited back (stake + profit) — a 50-coin bet that
    // returns 100 should read as "+100", not "+50", since 100 is what actually lands in the balance.
    setResultNotice({ net, amount: net > 0 ? payout : net, title: net > 0 ? "승리했습니다" : net < 0 ? "아쉽게 패배했습니다" : "베팅금이 반환됐습니다" });
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), RESULT_NOTICE_MS);
  }, [snapshot, visiblePlayerCards.length, visibleBankerCards.length]);

  // Belt-and-braces for the timeout above: a settlement notice must never survive into the
  // next round, however long the reveal took or how the round ended (abort, refund, pause).
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.roundId !== null && snapshot.roundId === noticeRoundRef.current) return;
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setResultNotice(null);
  }, [snapshot?.roundId]);

  // Deal the round's cards one at a time (Player, Banker, Player, Banker, then any third cards)
  // instead of dropping the whole final hand on screen at once.
  useEffect(() => {
    if (!snapshot) return;
    const roundId = snapshot.roundId;
    const hasCards = snapshot.playerCards.length > 0 && snapshot.bankerCards.length > 0;
    if (!hasCards) {
      if (dealtRoundRef.current !== roundId) {
        dealtRoundRef.current = null;
        setVisiblePlayerCards([]);
        setVisibleBankerCards([]);
      }
      return;
    }
    if (dealtRoundRef.current === roundId) return;
    dealtRoundRef.current = roundId;
    setVisiblePlayerCards([]);
    setVisibleBankerCards([]);
    for (const timer of dealTimers.current) window.clearTimeout(timer);
    dealTimers.current = [];

    const sequence: Array<{ target: "player" | "banker"; card: Card }> = [
      { target: "player", card: snapshot.playerCards[0]! },
      { target: "banker", card: snapshot.bankerCards[0]! },
      { target: "player", card: snapshot.playerCards[1]! },
      { target: "banker", card: snapshot.bankerCards[1]! },
    ];
    if (snapshot.playerCards[2]) sequence.push({ target: "player", card: snapshot.playerCards[2] });
    if (snapshot.bankerCards[2]) sequence.push({ target: "banker", card: snapshot.bankerCards[2] });

    playSound("deal");
    dealTimers.current = sequence.map((item, index) =>
      window.setTimeout(() => {
        if (item.target === "player") setVisiblePlayerCards((current) => [...current, item.card]);
        else setVisibleBankerCards((current) => [...current, item.card]);
        if (index === sequence.length - 1 && snapshot.result) {
          playSound(snapshot.result);
          if (burstRoundRef.current !== roundId) {
            burstRoundRef.current = roundId;
            if (snapshot.result === "player") spawnBurst(handRefs.current.player);
            if (snapshot.result === "banker") spawnBurst(handRefs.current.banker);
            BET_CHOICES.forEach((key) => {
              if ((snapshot.myBets[key] ?? 0) <= 0) return;
              const won =
                (key === "player" && snapshot.result === "player") ||
                (key === "banker" && snapshot.result === "banker") ||
                (key === "tie" && snapshot.result === "tie") ||
                (key === "player_pair" && snapshot.playerPair) ||
                (key === "banker_pair" && snapshot.bankerPair);
              if (won) spawnBurst(zoneRefs.current[key]);
            });
          }
        }
      }, index * DEAL_STEP_MS + DEAL_LEAD_MS + (index >= 4 ? THIRD_CARD_PAUSE_MS : 0)),
    );
  }, [snapshot]);

  const place = (choice: keyof RoomSnapshot["myBets"], amount = chip) => {
    if (!snapshot?.roundId) return;
    socket.emit("bet.place", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, choice, amount }, (ack) => {
      if (ack.ok) {
        setSnapshot((current) => (!current || ack.data.sequence >= current.sequence ? ack.data : current));
        const total = ack.data.myBets[choice] ?? amount;
        setMessage(`${choiceLabel(choice)} ${total}코인 베팅 완료`);
        spawnFlyingChip(choice, amount, chip);
      } else {
        setMessage(ack.error);
      }
    });
  };

  const hasCurrentBets = Object.values(snapshot?.myBets ?? {}).some((amount) => amount > 0);
  const canRepeat = Object.keys(lastBets.current).length > 0;
  const repeatBet = () => {
    for (const [choice, amount] of Object.entries(lastBets.current)) {
      if (amount) place(choice as keyof RoomSnapshot["myBets"], amount);
    }
  };

  const cancel = (choice: keyof RoomSnapshot["myBets"]) => {
    if (!snapshot?.roundId) return;
    socket.emit("bet.cancel", { roomId, roundId: snapshot.roundId, choice }, (ack) => {
      if (ack.ok) {
        setSnapshot((current) => (!current || ack.data.sequence >= current.sequence ? ack.data : current));
        setMessage(`${choiceLabel(choice)} 베팅을 취소했습니다.`);
      } else {
        setMessage(ack.error);
      }
    });
  };

  const clearAllBets = () => {
    BET_CHOICES.forEach((choice) => {
      if ((snapshot?.myBets[choice] ?? 0) > 0) cancel(choice);
    });
  };

  if (!snapshot) {
    return (
      <div className="loading-screen">
        <Brand />
        <p>{message || "테이블에 연결하고 있습니다…"}</p>
      </div>
    );
  }

  const betting = snapshot.room.phase === "BETTING";
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const playerScore = visiblePlayerCards.length >= 2 ? handScore(visiblePlayerCards) : null;
  const bankerScore = visibleBankerCards.length >= 2 ? handScore(visibleBankerCards) : null;
  const dealFullyRevealed = visiblePlayerCards.length === snapshot.playerCards.length && visibleBankerCards.length === snapshot.bankerCards.length;
  const showResult = Boolean(snapshot.result) && dealFullyRevealed;
  const currentBet = Object.values(snapshot.myBets).reduce((sum, amount) => sum + amount, 0);
  const affordableWallet = snapshot.lightningFeePercent === 20 ? Math.floor(snapshot.walletBalance / 1.2) : snapshot.walletBalance;
  const maxAdditional = maximumAdditionalBet(affordableWallet, currentBet, snapshot.room.maxBet);
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / BETTING_SECONDS));

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`MIN ${snapshot.room.minBet} · MAX ${snapshot.room.maxBet} · 남은 카드 ${snapshot.shoeRemaining}`}
      phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot.room.phase)}
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void toggleFullscreen()}
      shellRef={shellRef}
    >
      <div className="room-shell">
        <section className="ot-stage">
          <div className={`ot-felt baccarat ${snapshot.room.gameType === "lightning_baccarat" ? "lightning" : ""}`}>
            <div className="ot-feed">
              <WinnerFeed socket={socket} />
            </div>

            {snapshot.room.gameType === "lightning_baccarat" && (
              <div className="lightning-panel" aria-label="이번 라운드 라이트닝 카드">
                <strong>LIGHTNING</strong>
                <span className="lightning-fee">수수료 20%</span>
                <div className="lightning-card-list">
                  {(snapshot.lightningCards ?? []).length === 0 && <em>베팅 마감 후 공개</em>}
                  {(snapshot.lightningCards ?? []).map((item) => (
                    <span className="lightning-card" key={`${item.card.rank}${item.card.suit}`}>
                      <CardFace card={item.card} />
                      <b>×{item.multiplier}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="ot-hands">
              <div className={`ot-hand player ${showResult && snapshot.result === "player" ? "won" : ""}`} ref={(el) => { handRefs.current.player = el; }}>
                <div className="ot-hand-head">
                  PLAYER <span className="ot-score">{playerScore ?? 0}</span>
                </div>
                <div className="ot-cards">
                  {visiblePlayerCards.length === 0 && <span className="ot-card-slot">P</span>}
                  {visiblePlayerCards.map((card, index) => (
                    <PlayingCard key={`p-${index}`} card={card} />
                  ))}
                </div>
              </div>
              <div className={`ot-hand banker ${showResult && snapshot.result === "banker" ? "won" : ""}`} ref={(el) => { handRefs.current.banker = el; }}>
                <div className="ot-hand-head">
                  BANKER <span className="ot-score">{bankerScore ?? 0}</span>
                </div>
                <div className="ot-cards">
                  {visibleBankerCards.length === 0 && <span className="ot-card-slot">B</span>}
                  {visibleBankerCards.map((card, index) => (
                    <PlayingCard key={`b-${index}`} card={card} />
                  ))}
                </div>
              </div>
            </div>

            {betting && (
              <div className={`ot-timer ${seconds <= 4 ? "closing" : ""}`}>
                <svg viewBox="0 0 60 60">
                  <circle className="ot-timer-track" cx="30" cy="30" r="26" />
                  <circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} />
                </svg>
                <span className="ot-timer-num">{seconds}</span>
              </div>
            )}

            {snapshot.room.phase === "LOCKED" && <div className="ot-banner lock">베팅 마감</div>}
            {showResult && <div className={`ot-banner ${snapshot.result}`}>{snapshot.result!.toUpperCase()} WIN</div>}
            <RoundResultNotice notice={resultNotice} />

            <div className="ot-print">
              <BetZone buttonRef={(el) => { zoneRefs.current.player_pair = el; }} className="pair" label="P PAIR" odds="11:1" amount={snapshot.myBets.player_pair ?? 0} disabled={!betting} onPlace={() => place("player_pair")} />
              <BetZone buttonRef={(el) => { zoneRefs.current.player = el; }} className="player" label="PLAYER" odds="1:1" amount={snapshot.myBets.player ?? 0} disabled={!betting} onPlace={() => place("player")} />
              <BetZone buttonRef={(el) => { zoneRefs.current.tie = el; }} className="tie" label="TIE" odds="8:1" amount={snapshot.myBets.tie ?? 0} disabled={!betting} onPlace={() => place("tie")} />
              <BetZone buttonRef={(el) => { zoneRefs.current.banker = el; }} className="banker" label="BANKER" odds="0.95:1" amount={snapshot.myBets.banker ?? 0} disabled={!betting} onPlace={() => place("banker")} />
              <BetZone buttonRef={(el) => { zoneRefs.current.banker_pair = el; }} className="pair" label="B PAIR" odds="11:1" amount={snapshot.myBets.banker_pair ?? 0} disabled={!betting} onPlace={() => place("banker_pair")} />
            </div>

            <aside className="ot-road left">
              <BigRoad history={snapshot.recentResults} prediction={roadPrediction} onPredict={(result) => setRoadPrediction((current) => current === result ? null : result)} />
            </aside>
            <aside className="ot-road right">
              <DerivedRoads history={snapshot.recentResults} prediction={roadPrediction} />
            </aside>

            {message && <p className="ot-message">{message}</p>}

            <div ref={overlayRef} className="table-effects-layer" aria-hidden="true">
              {flyingChips.map((flyingChip) => (
                <motion.div
                  key={flyingChip.id}
                  className="flying-chip"
                  style={{ "--chip-face": flyingChip.color } as CSSProperties}
                  initial={{ x: flyingChip.fromX - 14, y: flyingChip.fromY - 14, opacity: 1, scale: 1 }}
                  animate={{ x: flyingChip.toX - 14, y: flyingChip.toY - 14, opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.42, ease: "easeIn" }}
                  onAnimationComplete={() => setFlyingChips((value) => value.filter((item) => item.id !== flyingChip.id))}
                >
                  {flyingChip.value}
                </motion.div>
              ))}
              <AnimatePresence>
                {bursts.map((burst) => (
                  <Burst key={burst.id} x={burst.x} y={burst.y} onDone={() => setBursts((value) => value.filter((item) => item.id !== burst.id))} />
                ))}
              </AnimatePresence>
            </div>
          </div>

          <footer className="ot-rail">
            <div className="ot-tray">
              {chipValues.map((value) => (
                <button
                  key={value}
                  ref={(el) => { chipRefs.current[value] = el; }}
                  className={`chip chip-option chip-tier-${chipTier(value)} ${chip === value ? "active" : ""}`}
                  onClick={() => setChip(value)}
                >
                  {value}
                </button>
              ))}
              {!chipValues.includes(maxAdditional) && <button
                type="button"
                className={`chip chip-option chip-max ${chip === maxAdditional ? "active" : ""}`}
                disabled={!betting || maxAdditional <= 0 || (currentBet === 0 && maxAdditional < snapshot.room.minBet)}
                onClick={() => setChip(maxAdditional)}
                title={`가능한 최대 금액 ${maxAdditional}코인`}
              >{maxAdditional}</button>}
              <button type="button" className={`chip-picker-trigger chip-tier-${chipTier(chip)}`} aria-label="칩 단위 선택" aria-expanded={chipMenuOpen} onClick={() => setChipMenuOpen((open) => !open)}>{chip}</button>
              {chipMenuOpen && <div className="chip-picker-menu" role="menu">{[...chipValues, ...(!chipValues.includes(maxAdditional) && maxAdditional > 0 ? [maxAdditional] : [])].map((value) => <button type="button" role="menuitem" key={value} className={`chip-tier-${chipTier(value)} ${chip === value ? "selected" : ""}`} onClick={() => { setChip(value); setChipMenuOpen(false); }}>{value}</button>)}</div>}
            </div>

            <div className="ot-acts">
              <button type="button" className="outline-button icon-action" aria-label="전체 베팅 되돌리기" title="전체 베팅 되돌리기" disabled={!betting || currentBet === 0} onClick={clearAllBets}>
                <Undo2 size={17} />
              </button>
              <button type="button" className="outline-button icon-action" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasCurrentBets || !canRepeat} onClick={repeatBet}>
                <Repeat2 size={17} />
              </button>
            </div>

            <div className="ot-money right">
              <small>{snapshot.lightningFeePercent === 20 ? "베팅 + 수수료" : "총 베팅"}</small>
              <strong>{(currentBet + (snapshot.lightningFeePercent === 20 ? lightningFee(currentBet, 20) : 0)).toLocaleString()}</strong>
            </div>
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </footer>
        </section>
      </div>
    </GameShell>
  );
}

function phaseLabel(phase: RoomSnapshot["room"]["phase"]) {
  return {
    WAITING: "플레이어 대기",
    BETTING: "베팅 중",
    LOCKED: "베팅 마감",
    DEALING: "카드 오픈",
    INSURANCE: "보험 선택",
    PLAYER_TURN: "플레이어 턴",
    DEALER_TURN: "딜러 턴",
    SETTLING: "정산 중",
    RESULT: "라운드 결과",
  }[phase];
}

function choiceLabel(choice: keyof RoomSnapshot["myBets"]) {
  return { player: "PLAYER", banker: "BANKER", tie: "TIE", player_pair: "P PAIR", banker_pair: "B PAIR" }[choice];
}
