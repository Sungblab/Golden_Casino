import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { BlackjackAction, BlackjackRoomSnapshot, ClientToServerEvents, ServerToClientEvents } from "@golden/contracts";
import { handValue } from "@golden/game-core/blackjack";
import { API_URL } from "../api";
import { GameShell } from "../components/GameShell";
import { Brand } from "../components/Brand";
import { PlayingCard } from "../components/PlayingCard";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { playSound } from "../lib/sound";
import { useCountUp } from "../lib/useCountUp";

const CHIP_TIERS = [1, 5, 10, 25, 100];
const TOTAL_SHOE_CARDS = 312;
/** Must match blackjack-room-manager.ts's BETTING_MS (12_000ms) — drives the countdown ring. */
const BETTING_SECONDS = 12;
/** Circumference of the countdown ring's r=26 circle (2πr), used for its stroke-dashoffset animation. */
const TIMER_RING = 163.4;

const OUTCOME_LABEL: Record<string, string> = {
  win: "승리",
  lose: "패배",
  push: "푸시",
  blackjack: "블랙잭",
};

export function BlackjackRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<BlackjackRoomSnapshot | null>(null);
  const [chip, setChip] = useState(1);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dealtRoundRef = useRef<string | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const displayBalance = useCountUp(snapshot?.walletBalance ?? 0);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(() => io(API_URL, { auth: { token }, autoConnect: false }), [token]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async (): Promise<void> => {
    if (!shellRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shellRef.current.requestFullscreen();
  };

  useEffect(() => {
    const acceptSnapshot = (next: BlackjackRoomSnapshot) => setSnapshot((current) => (!current || next.sequence >= current.sequence ? next : current));
    const handleWallet = ({ balance }: { balance: number }) => setSnapshot((current) => (current ? { ...current, walletBalance: balance } : current));
    const handleConnect = () => socket.emit("blackjack.join", { roomId }, (ack) => (ack.ok ? acceptSnapshot(ack.data) : setMessage(ack.error)));
    const handleConnectError = (error: Error) => {
      if (error.message === "UNAUTHORIZED") window.dispatchEvent(new Event("golden:session-expired"));
      else setMessage("게임 서버에 연결할 수 없습니다.");
    };
    const handleNotification = ({ message: nextMessage }: { message: string }) => setMessage(nextMessage);
    socket.on("blackjack.snapshot", acceptSnapshot);
    socket.on("wallet.updated", handleWallet);
    socket.on("notification", handleNotification);
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.connect();
    return () => {
      socket.emit("blackjack.leave", { roomId }, () => undefined);
      socket.off("blackjack.snapshot", acceptSnapshot);
      socket.off("wallet.updated", handleWallet);
      socket.off("notification", handleNotification);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.disconnect();
    };
  }, [roomId, socket]);

  useEffect(() => {
    const update = () => setSeconds(snapshot?.phaseEndsAt ? Math.max(0, Math.ceil((new Date(snapshot.phaseEndsAt).getTime() - Date.now()) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [snapshot?.phaseEndsAt]);

  useEffect(() => {
    const maxBet = snapshot?.room.maxBet;
    if (!maxBet) return;
    const allowed = CHIP_TIERS.filter((value) => value <= maxBet);
    setChip((current) => (allowed.includes(current) ? current : (allowed.at(-1) ?? 1)));
  }, [snapshot?.room.maxBet]);

  // Play the deal sound once per round when the dealer's cards first land.
  useEffect(() => {
    if (!snapshot?.roundId) return;
    if (snapshot.dealerCards.length === 0) return;
    if (dealtRoundRef.current === snapshot.roundId) return;
    dealtRoundRef.current = snapshot.roundId;
    playSound("deal");
  }, [snapshot]);

  const placeBet = () => {
    if (!snapshot?.roundId) return;
    socket.emit("blackjack.bet", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, amount: chip }, (ack) => {
      if (ack.ok) {
        setSnapshot((current) => (!current || ack.data.sequence >= current.sequence ? ack.data : current));
        setMessage(`${chip}코인 베팅 완료`);
        playSound("chip");
      } else {
        setMessage(ack.error);
      }
    });
  };

  const act = (action: BlackjackAction) => {
    if (!snapshot?.roundId) return;
    socket.emit("blackjack.action", { roomId, roundId: snapshot.roundId, action }, (ack) => {
      if (ack.ok) setSnapshot((current) => (!current || ack.data.sequence >= current.sequence ? ack.data : current));
      else setMessage(ack.error);
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
  const myTurn = snapshot.room.phase === "PLAYER_TURN" && snapshot.myHand?.status === "playing";
  const chipValues = CHIP_TIERS.filter((value) => value <= snapshot.room.maxBet);
  const shoePercent = Math.min(100, Math.max(0, Math.round((snapshot.shoeRemaining / TOTAL_SHOE_CARDS) * 100)));
  const dealerLiveScore = snapshot.dealerCards.length > 0 ? handValue(snapshot.dealerCards).total : null;
  const canDouble = myTurn && snapshot.myHand!.cards.length === 2;
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / BETTING_SECONDS));
  const phase = snapshot.room.phase;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`MIN ${snapshot.room.minBet} · MAX ${snapshot.room.maxBet} · 남은 카드 ${snapshot.shoeRemaining}`}
      phaseLabel={snapshot.room.paused ? "일시정지" : blackjackPhaseLabel(snapshot.room.phase)}
      phaseSeconds={seconds}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void toggleFullscreen()}
    >
      <div ref={shellRef} className={`room-shell ${isFullscreen ? "is-fullscreen" : ""}`}>
        <div className="shoe-meter">
          <span>남은 슈 {snapshot.shoeRemaining} / {TOTAL_SHOE_CARDS}</span>
          <div className="shoe-meter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shoePercent}>
            <div className="shoe-meter-fill" style={{ width: `${shoePercent}%` }} />
          </div>
        </div>

        <section className="ot-stage">
          <div className="ot-felt bj">
            <p className="ot-status">{snapshot.room.paused ? "테이블이 일시정지되었습니다" : blackjackPhaseLabel(phase)}</p>

            <div className="ot-feed">
              <WinnerFeed socket={socket} />
            </div>

            <div className="ot-dealer-row">
              <div className="ot-hand dealer">
                <div className="ot-hand-head">
                  DEALER <span className="ot-score">{snapshot.dealerHoleHidden ? "?" : (dealerLiveScore ?? 0)}</span>
                </div>
                <div className="ot-cards">
                  {snapshot.dealerCards.length === 0 && <span className="ot-card-slot">D</span>}
                  {snapshot.dealerCards.map((cardEntry, index) => (
                    <PlayingCard key={`dealer-${index}`} card={cardEntry} />
                  ))}
                  {snapshot.dealerHoleHidden && snapshot.dealerCards.length > 0 && (
                    <span className="playing-card">
                      <span className="playing-card-inner">
                        <span className="playing-card-back">
                          <BackFacePlaceholder />
                        </span>
                      </span>
                    </span>
                  )}
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
            {phase === "LOCKED" && <div className="ot-banner lock">베팅 마감</div>}
            {phase === "DEALER_TURN" && <div className="ot-banner lock">딜러 턴</div>}
            {phase === "RESULT" && snapshot.myHand?.outcome && (
              <div className={`ot-banner ${snapshot.myHand.outcome}`}>{OUTCOME_LABEL[snapshot.myHand.outcome]}</div>
            )}

            <div className="seat-arc">
              {seatLayout(snapshot.hands.length).map((seat, index) => {
                const hand = snapshot.hands[index];
                const style = { "--seat-t": seat.t } as CSSProperties;
                if (!hand) {
                  return (
                    <div key={`empty-${index}`} className="seat empty-seat" style={style}>
                      <span className="empty-seat-glyph" aria-hidden="true">
                        <ChairIcon />
                      </span>
                      <span className="empty-seat-label">빈 좌석</span>
                    </div>
                  );
                }
                const mine = hand.userId === snapshot.myHand?.userId;
                const total = hand.cards.length > 0 ? handValue(hand.cards).total : 0;
                return (
                  <div key={hand.userId} className="seat" style={style}>
                    <div className={`hand player-hand ${mine ? "hand-mine" : ""} ${hand.status}`}>
                      <div className="hand-heading">
                        <span>{mine ? "MY HAND" : hand.username}</span>
                        <strong>{total}</strong>
                      </div>
                      <div className="dealt-cards">
                        {hand.cards.map((cardEntry, index) => (
                          <PlayingCard key={`${hand.userId}-${index}`} card={cardEntry} animate={mine} />
                        ))}
                      </div>
                      <div className="hand-footer">
                        <span className="hand-bet">{hand.bet.toLocaleString()} C</span>
                        {hand.status === "bust" && <span className="hand-badge bust">BUST</span>}
                        {hand.status === "blackjack" && <span className="hand-badge blackjack">BLACKJACK</span>}
                        {hand.status === "doubled" && <span className="hand-badge doubled">DOUBLE</span>}
                        {hand.outcome && <span className={`hand-badge outcome-${hand.outcome}`}>{OUTCOME_LABEL[hand.outcome]}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="ot-rail">
            <div className="ot-money">
              <small>잔고</small>
              <strong>{displayBalance.toLocaleString()}</strong>
            </div>

            {betting && !snapshot.myHand && (
              <>
                <div className="ot-tray">
                  {chipValues.map((value) => (
                    <button key={value} className={`chip chip-tier-${CHIP_TIERS.indexOf(value)} ${chip === value ? "active" : ""}`} onClick={() => setChip(value)}>
                      {value}
                    </button>
                  ))}
                </div>
                <button type="button" className="bet-confirm-button" onClick={placeBet}>
                  베팅하기
                </button>
              </>
            )}
            {betting && snapshot.myHand && <p className="bet-message">베팅 완료 · {snapshot.myHand.bet}코인</p>}
            {myTurn && (
              <div className="ot-acts">
                <button type="button" className="outline-button" onClick={() => act("hit")}>
                  히트
                </button>
                <button type="button" className="outline-button" onClick={() => act("stand")}>
                  스탠드
                </button>
                <button type="button" className="outline-button" disabled={!canDouble} onClick={() => act("double")}>
                  더블다운
                </button>
              </div>
            )}
            {!betting && !myTurn && <p className="bet-message">{message}</p>}

            <div className="ot-money right">
              <small>내 베팅</small>
              <strong>{(snapshot.myHand?.bet ?? 0).toLocaleString()}</strong>
            </div>
          </footer>
        </section>

        <RoomChat socket={socket} roomId={roomId} token={token} />
      </div>
    </GameShell>
  );
}

/** Always show at least this many seats around the table, even with no one in them yet. */
const BASELINE_SEATS = 5;

/**
 * Lays seats out along an arc under the dealer: `t` is each seat's signed offset from
 * center, used in CSS as translateY(t² ) + rotate(t) so the row bows like a real table
 * instead of a flat strip. No hard cap — once more players join than the baseline, the
 * arc simply grows (and wraps onto a second row via flex-wrap for very large tables).
 */
function seatLayout(occupied: number): Array<{ t: number }> {
  const count = Math.max(occupied, BASELINE_SEATS);
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => ({ t: index - center }));
}

function ChairIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3.5h12M7 3.5v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9M8 20.5l1-6M16 20.5l-1-6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BackFacePlaceholder() {
  return (
    <svg viewBox="0 0 64 90" className="card-face-svg" role="img" aria-hidden="true">
      <rect x="1" y="1" width="62" height="88" rx="7" fill="#0c2a1d" stroke="#b8860b" strokeWidth="1.5" />
      <rect x="6" y="6" width="52" height="78" rx="4" fill="none" stroke="#d8a20a" strokeWidth="1" opacity="0.55" />
      <circle cx="32" cy="45" r="10" fill="none" stroke="#ffd658" strokeWidth="1.25" opacity="0.8" />
      <text x="32" y="50" fontSize="11" fill="#ffd658" textAnchor="middle" fontFamily="'Noto Serif KR', serif" fontWeight="700">
        GC
      </text>
    </svg>
  );
}

function blackjackPhaseLabel(phase: BlackjackRoomSnapshot["room"]["phase"]): string {
  return (
    {
      WAITING: "플레이어 대기",
      BETTING: "베팅 중",
      LOCKED: "베팅 마감",
      DEALING: "카드 배분 중",
      PLAYER_TURN: "플레이어 턴",
      DEALER_TURN: "딜러 턴",
      SETTLING: "정산 중",
      RESULT: "라운드 결과",
    } as const
  )[phase];
}
