import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Repeat2, Undo2 } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  DragonTigerBetChoice,
  DragonTigerRoomSnapshot,
  RoundHistoryEntry,
  ServerToClientEvents,
} from "@golden/contracts";
import { payoutForDragonTigerBet } from "@golden/game-core/dragon-tiger";
import { API_URL } from "../api";
import { Brand } from "../components/Brand";
import { BetZone } from "../components/BetZone";
import { BigRoad } from "../components/BigRoad";
import { GameShell } from "../components/GameShell";
import { PlayingCard } from "../components/PlayingCard";
import { RoomChat } from "../components/RoomChat";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { WinnerFeed } from "../components/WinnerFeed";
import { chipTier, chipValuesForRoom, maximumAdditionalBet } from "../lib/betting";
import { playSound } from "../lib/sound";

const BETTING_SECONDS = 12;
const TIMER_RING = 163.4;
const RESULT_NOTICE_MS = 2_600;
const ROAD_LABELS = { player: "D", banker: "T" } as const;
const BET_CHOICES: DragonTigerBetChoice[] = ["dragon", "tie", "suited_tie", "tiger"];
/** Beat after both cards finish their flip animation before the road updates, same reasoning
 * as Baccarat's ROAD_REVEAL_DELAY_MS — the scoreboard shouldn't know the outcome before the
 * cards have visibly finished revealing. */
const ROAD_REVEAL_DELAY_MS = 450;

export function DragonTigerRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<DragonTigerRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const [chipMenuOpen, setChipMenuOpen] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const noticeRoundRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [visibleRoadHistory, setVisibleRoadHistory] = useState<RoundHistoryEntry[]>([]);
  // Gates the WIN banner, "MY RESULT" notice, and the road update — all three previously fired
  // the instant snapshot.result arrived, which is before the Dragon/Tiger PlayingCard's own flip
  // animation has visibly finished, reading as the result being announced before the cards
  // finished turning over ("결과가 정해진거같잖아"). Same fix as Baccarat's deal-sequence effect.
  const [resultRevealed, setResultRevealed] = useState(false);
  const roadRevealTimer = useRef<number | null>(null);
  const roadRevealedRoundRef = useRef<string | null>(null);
  const previousPhase = useRef<DragonTigerRoomSnapshot["room"]["phase"] | null>(null);
  const lastBets = useRef<Partial<DragonTigerRoomSnapshot["myBets"]>>({});
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(API_URL, { auth: { token }, autoConnect: false }),
    [token],
  );

  useEffect(() => {
    const accept = (next: DragonTigerRoomSnapshot) => setSnapshot((current) => !current || next.sequence >= current.sequence ? next : current);
    const onConnect = () => socket.emit("dragonTiger.join", { roomId }, (ack) => ack.ok ? accept(ack.data) : setMessage(ack.error));
    const onWallet = ({ balance }: { balance: number }) => setSnapshot((current) => current ? { ...current, walletBalance: balance } : current);
    const onConnectError = (error: Error) => error.message === "UNAUTHORIZED"
      ? window.dispatchEvent(new Event("golden:session-expired"))
      : setMessage("게임 서버에 연결할 수 없습니다.");
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("dragonTiger.snapshot", accept);
    socket.on("wallet.updated", onWallet);
    socket.connect();
    return () => {
      socket.emit("dragonTiger.leave", { roomId }, () => undefined);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("dragonTiger.snapshot", accept);
      socket.off("wallet.updated", onWallet);
      socket.disconnect();
    };
  }, [roomId, socket]);

  useEffect(() => {
    const update = () => setSeconds(snapshot?.phaseEndsAt ? Math.max(0, Math.ceil((Date.parse(snapshot.phaseEndsAt) - Date.now()) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [snapshot?.phaseEndsAt]);

  useEffect(() => {
    if (!snapshot) return;
    const values = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => values.includes(current) ? current : values[0]!);
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]);

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  // Personal win/loss feedback, same "+total returned, not just profit" convention as Baccarat/Blackjack.
  useEffect(() => {
    if (!snapshot?.roundId || !snapshot.result || !resultRevealed || noticeRoundRef.current === snapshot.roundId) return;
    const settledBets = snapshot.myBets;
    const totalBet = Object.values(settledBets).reduce((sum, amount) => sum + (amount ?? 0), 0);
    if (totalBet <= 0) return;
    noticeRoundRef.current = snapshot.roundId;
    const outcome = { dragonCard: snapshot.dragonCard!, tigerCard: snapshot.tigerCard!, result: snapshot.result, suitedTie: snapshot.suitedTie };
    const payout = Object.entries(settledBets).reduce(
      (sum, [choice, amount]) => sum + payoutForDragonTigerBet(choice as DragonTigerBetChoice, outcome, amount ?? 0),
      0,
    );
    const net = payout - totalBet;
    setResultNotice({ net, amount: net > 0 ? payout : net, title: net > 0 ? "승리했습니다" : net < 0 ? "아쉽게 패배했습니다" : "베팅금이 반환됐습니다" });
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), RESULT_NOTICE_MS);
  }, [snapshot, resultRevealed]);

  useEffect(() => {
    if (!snapshot || snapshot.roundId !== null) return;
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setResultNotice(null);
  }, [snapshot?.roundId]);

  // Snapshot this round's bets so "repeat bet" has something to replay next round.
  useEffect(() => {
    if (!snapshot) return;
    const phase = snapshot.room.phase;
    if (phase === previousPhase.current) return;
    previousPhase.current = phase;
    // `message` is otherwise never cleared — a rejected-bet error would sit on screen through
    // settlement and into the next round's betting window.
    if (phase === "BETTING") { setMessage(""); playSound("chip"); }
    if (phase === "LOCKED") {
      playSound("deal");
      const placed = Object.fromEntries(Object.entries(snapshot.myBets).filter(([, amount]) => (amount ?? 0) > 0));
      if (Object.keys(placed).length > 0) lastBets.current = placed;
    }
  }, [snapshot]);

  const roadHistory: RoundHistoryEntry[] = useMemo(
    () => (snapshot?.recentResults ?? []).map((entry) => ({
      result: entry.result === "dragon" ? "player" : entry.result === "tiger" ? "banker" : "tie",
      playerPair: false,
      bankerPair: entry.suitedTie,
    })),
    [snapshot?.recentResults],
  );

  // Lags the road behind roadHistory while the Dragon/Tiger cards are still flipping, so the
  // scoreboard doesn't visibly update before the reveal — mirrors Baccarat's own deal-sequence fix.
  useEffect(() => {
    if (!snapshot) return;
    if (!snapshot.result) {
      // No result in flight — safe to match the server's history immediately.
      setVisibleRoadHistory(roadHistory);
      if (roadRevealedRoundRef.current !== snapshot.roundId) {
        roadRevealedRoundRef.current = null;
        setResultRevealed(false);
      }
      return;
    }
    if (roadRevealedRoundRef.current === snapshot.roundId) return;
    roadRevealedRoundRef.current = snapshot.roundId;
    if (roadRevealTimer.current !== null) window.clearTimeout(roadRevealTimer.current);
    roadRevealTimer.current = window.setTimeout(() => {
      setVisibleRoadHistory(roadHistory);
      setResultRevealed(true);
      playSound(snapshot.result!);
    }, ROAD_REVEAL_DELAY_MS);
  }, [snapshot, roadHistory]);

  useEffect(() => () => {
    if (roadRevealTimer.current !== null) window.clearTimeout(roadRevealTimer.current);
  }, []);

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;

  const betting = snapshot.room.phase === "BETTING";
  const currentBet = Object.values(snapshot.myBets).reduce((sum, value) => sum + value, 0);
  const maxAdditional = maximumAdditionalBet(snapshot.walletBalance, currentBet, snapshot.room.maxBet);
  const chips = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / BETTING_SECONDS));
  // Suited Tie is capped lower than the table's main limit (see bet-service.ts SIDE_BET_CHOICES) —
  // surface that cap in the odds line so a rejected bet isn't a mystery.
  const suitedTieOdds = snapshot.room.sideBetMax ? `50:1 · MAX ${snapshot.room.sideBetMax}` : "50:1";
  // Live-table board: everyone's bets this round, not just mine — each zone's share of the
  // total pot plus how many players are backing it.
  const totalPot = Object.values(snapshot.betTotals).reduce((sum, total) => sum + total.amount, 0);
  const zoneShare = (choice: DragonTigerBetChoice) => {
    const total = snapshot.betTotals[choice];
    return { sharePercent: total && totalPot > 0 ? Math.round((total.amount / totalPot) * 100) : undefined, players: total?.players };
  };

  const place = (choice: DragonTigerBetChoice, amount = chip) => {
    if (!snapshot.roundId) return;
    socket.emit("dragonTiger.bet", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, choice, amount }, (ack) => {
      if (ack.ok) {
        setSnapshot(ack.data);
        setMessage(`${label(choice)} ${amount}코인 베팅 완료`);
      } else setMessage(ack.error);
    });
  };
  const cancel = (choice: DragonTigerBetChoice) => {
    if (!snapshot.roundId) return;
    socket.emit("dragonTiger.cancel", { roomId, roundId: snapshot.roundId, choice }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };
  const clearAllBets = () => {
    BET_CHOICES.forEach((choice) => {
      if ((snapshot.myBets[choice] ?? 0) > 0) cancel(choice);
    });
  };
  const hasCurrentBets = Object.values(snapshot.myBets).some((amount) => (amount ?? 0) > 0);
  const canRepeat = Object.keys(lastBets.current).length > 0;
  const repeatBet = () => {
    for (const [choice, amount] of Object.entries(lastBets.current)) {
      if (amount) place(choice as DragonTigerBetChoice, amount);
    }
  };

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`MIN ${snapshot.room.minBet} · MAX ${snapshot.room.maxBet} · 8덱 · 남은 카드 ${snapshot.shoeRemaining}`}
      phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot.room.phase)}
      // The felt's own ring timer already shows the countdown during betting — showing it
      // a second time up in the bar was redundant. Other timed phases (no ring) still show it.
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
    >
      <div className="room-shell">
        <section className="ot-stage">
          <div className="ot-felt baccarat dragon-tiger-felt">
            <div className="ot-feed"><WinnerFeed socket={socket} /></div>
            <div className="ot-hands dragon-tiger-hands">
              <div className={`ot-hand player ${snapshot.result === "dragon" ? "won" : ""}`}>
                <div className="ot-hand-head">DRAGON</div>
                <div className="ot-cards">{snapshot.dragonCard ? <PlayingCard card={snapshot.dragonCard} /> : <span className="ot-card-slot">D</span>}</div>
              </div>
              <div className="dragon-tiger-center">
                <span className="dragon-tiger-center-odds">TIE 11:1</span>
                <span className="dragon-tiger-center-badge">VS</span>
                <span className="dragon-tiger-center-odds">SUITED 50:1</span>
              </div>
              <div className={`ot-hand banker ${snapshot.result === "tiger" ? "won" : ""}`}>
                <div className="ot-hand-head">TIGER</div>
                <div className="ot-cards">{snapshot.tigerCard ? <PlayingCard card={snapshot.tigerCard} /> : <span className="ot-card-slot">T</span>}</div>
              </div>
            </div>
            {betting && <div className={`ot-timer ${seconds <= 4 ? "closing" : ""}`}>
              <svg viewBox="0 0 60 60"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} /></svg>
              <span className="ot-timer-num">{seconds}</span>
            </div>}
            {snapshot.room.phase === "LOCKED" && <div className="ot-banner lock">베팅 마감</div>}
            {snapshot.result && resultRevealed && <div className={`ot-banner ${snapshot.result}`}>{snapshot.suitedTie ? "SUITED TIE" : snapshot.result.toUpperCase()} WIN</div>}
            <RoundResultNotice notice={resultNotice} />
            {/* Dragon left / Tiger right (matching the physical card positions above), with Tie and
                Suited Tie grouped in the middle two columns — Evolution's own Dragon Tiger layout. */}
            <div className="ot-print dragon-tiger-print">
              <BetZone className="player" label="DRAGON" odds="1:1" amount={snapshot.myBets.dragon ?? 0} disabled={!betting} onPlace={() => place("dragon")} {...zoneShare("dragon")} />
              <BetZone className="tie" label="TIE" odds="11:1" amount={snapshot.myBets.tie ?? 0} disabled={!betting} onPlace={() => place("tie")} {...zoneShare("tie")} />
              <BetZone className="pair" label="SUITED TIE" odds={suitedTieOdds} amount={snapshot.myBets.suited_tie ?? 0} disabled={!betting} onPlace={() => place("suited_tie")} {...zoneShare("suited_tie")} />
              <BetZone className="banker" label="TIGER" odds="1:1" amount={snapshot.myBets.tiger ?? 0} disabled={!betting} onPlace={() => place("tiger")} {...zoneShare("tiger")} />
            </div>
            <aside className="ot-road left dragon-tiger-road">
              <BigRoad history={visibleRoadHistory} compact labels={ROAD_LABELS} />
            </aside>
            {message && <p className="ot-message">{message}</p>}
          </div>
          <footer className="ot-rail">
            <div className="ot-tray">
              {chips.map((value) => <button key={value} className={`chip chip-option chip-tier-${chipTier(value)} ${chip === value ? "active" : ""}`} onClick={() => setChip(value)}>{value}</button>)}
              {maxAdditional > 0 && !chips.includes(maxAdditional) && <button
                type="button"
                className={`chip chip-option chip-max ${chip === maxAdditional ? "active" : ""}`}
                disabled={!betting}
                onClick={() => setChip(maxAdditional)}
                title={`가능한 최대 금액 ${maxAdditional}코인`}
              >{maxAdditional}</button>}
              <button type="button" className={`chip-picker-trigger chip-tier-${chipTier(chip)}`} aria-label="칩 단위 선택" aria-expanded={chipMenuOpen} onClick={() => setChipMenuOpen((open) => !open)}>{chip}</button>
              {chipMenuOpen && <div className="chip-picker-menu" role="menu">{[...chips, ...(maxAdditional > 0 && !chips.includes(maxAdditional) ? [maxAdditional] : [])].map((value) => <button type="button" role="menuitem" key={value} className={`chip-tier-${chipTier(value)} ${chip === value ? "selected" : ""}`} onClick={() => { setChip(value); setChipMenuOpen(false); }}>{value}</button>)}</div>}
            </div>
            <div className="ot-acts">
              <button type="button" className="outline-button icon-action" aria-label="전체 베팅 되돌리기" title="전체 베팅 되돌리기" disabled={!betting || !hasCurrentBets} onClick={clearAllBets}>
                <Undo2 size={17} />
              </button>
              <button type="button" className="outline-button icon-action" aria-label="이전 베팅 반복" title="이전 베팅 반복" disabled={!betting || hasCurrentBets || !canRepeat} onClick={repeatBet}>
                <Repeat2 size={17} />
              </button>
            </div>
            <div className="ot-money right"><small>총 베팅</small><strong>{currentBet.toLocaleString()}</strong></div>
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </footer>
        </section>
      </div>
    </GameShell>
  );
}

function label(choice: DragonTigerBetChoice): string {
  return { dragon: "DRAGON", tiger: "TIGER", tie: "TIE", suited_tie: "SUITED TIE" }[choice];
}

function phaseLabel(phase: DragonTigerRoomSnapshot["room"]["phase"]): string {
  return { WAITING: "플레이어 대기", BETTING: "베팅 중", LOCKED: "베팅 마감", DEALING: "카드 오픈", INSURANCE: "보험 선택", PLAYER_TURN: "플레이어 턴", DEALER_TURN: "딜러 턴", SETTLING: "정산 중", RESULT: "라운드 결과" }[phase];
}
