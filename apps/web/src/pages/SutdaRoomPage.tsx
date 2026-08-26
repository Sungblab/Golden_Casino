import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, SutdaAction, SutdaRoomSnapshot, SutdaSeatSnapshot } from "@golden/contracts";
import { API_URL } from "../api";
import { Brand } from "../components/Brand";
import { ChipStack } from "../components/ChipStack";
import { GameShell } from "../components/GameShell";
import { HwatuCard } from "../components/HwatuCard";
import { OrientationGate } from "../components/OrientationGate";
import { RoomChat } from "../components/RoomChat";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { SutdaHandGuide } from "../components/SutdaHandGuide";
import { applyShoeFlight } from "../lib/shoeFlight";
import { playSound } from "../lib/sound";
import { randomRequestId } from "../lib/requestId";

const ACTION_SECONDS = 20;
const TIMER_RING = 163.4;
// Same table geometry as Hold'em (see its SeatView): x/y radii tuned as a pair with the
// action-line ellipse in table-holdem.css — the two games share the whole table system.
const SEAT_ANGLES = [90, 150, 210, 270, 330, 30];

export function SutdaRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<SutdaRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const noticeKeyRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<SutdaRoomSnapshot["room"]["phase"] | null>(null);
  const prevTurnRef = useRef(false);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(() => io(API_URL, { auth: { token }, autoConnect: false }), [token]);

  useEffect(() => {
    const accept = (next: SutdaRoomSnapshot) => setSnapshot((current) => !current || next.sequence >= current.sequence ? next : current);
    const connect = () => socket.emit("sutda.join", { roomId }, (ack) => ack.ok ? accept(ack.data) : setMessage(ack.error));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => current ? { ...current, walletBalance: balance } : current);
    socket.on("connect", connect);
    socket.on("sutda.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", () => setMessage("게임 서버에 연결할 수 없습니다."));
    socket.connect();
    return () => { socket.emit("sutda.leave", { roomId }, () => undefined); socket.disconnect(); socket.off(); };
  }, [roomId, socket]);

  useEffect(() => {
    const update = () => setSeconds(snapshot?.phaseEndsAt ? Math.max(0, Math.ceil((Date.parse(snapshot.phaseEndsAt) - Date.now()) / 1000)) : 0);
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [snapshot?.phaseEndsAt]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  // Table cues, once per transition: the deal riffle when cards go out, the turn chime the
  // moment it becomes my decision — same conventions as the Hold'em room.
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.room.phase !== prevPhaseRef.current) {
      if (snapshot.room.phase === "DEALING") playSound("deal");
      prevPhaseRef.current = snapshot.room.phase;
    }
    const myTurnNow = snapshot.mySeatNumber !== null && snapshot.actingSeat === snapshot.mySeatNumber;
    if (myTurnNow && !prevTurnRef.current) playSound("turn");
    prevTurnRef.current = myTurnNow;
  }, [snapshot]);

  // Personal win banner. lastWinners persists through the between-hands WAITING, so key the
  // notice on its content rather than the (already cleared) roundId.
  useEffect(() => {
    if (!snapshot || snapshot.lastWinners.length === 0 || snapshot.mySeatNumber === null) return;
    const key = snapshot.lastWinners.map((w) => `${w.seatNumber}:${w.amount}`).join("|");
    if (noticeKeyRef.current === key) return;
    noticeKeyRef.current = key;
    const mine = snapshot.lastWinners.find((w) => w.seatNumber === snapshot.mySeatNumber);
    if (!mine) return;
    setResultNotice({ net: mine.amount, amount: mine.amount, title: `${mine.handLabel} 승리` });
    playSound("win");
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), 3600);
  }, [snapshot]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "섯다방에 연결하고 있습니다…"}</p></div>;

  const mine = snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber) ?? null;
  const myTurn = snapshot.actingSeat === snapshot.mySeatNumber && snapshot.mySeatNumber !== null;
  const seated = snapshot.seats.filter((seat) => seat.userId).length;
  const readyCount = snapshot.seats.filter((seat) => seat.userId && seat.ready).length;
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / ACTION_SECONDS));
  const winnerBySeat = new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner]));
  // Mirror of the server's 하프 sizing (sutda-room-manager.apply): half the pot, at least the
  // ante, capped by the table limit — shown on the button so a raise is never a surprise amount.
  const toCall = snapshot.toCall;
  const halfRaise = mine ? Math.min(Math.max(snapshot.room.minBet, Math.round(snapshot.pot.amount / 2)), Math.max(0, snapshot.room.maxBet - mine.totalContributed - toCall)) : 0;

  const command = (action: SutdaAction) => {
    if (!snapshot.roundId) return;
    socket.emit("sutda.act", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, action }, (ack) => {
      if (ack.ok) { setSnapshot(ack.data); playSound(action === "die" ? "fold" : "chip"); }
      else setMessage(ack.error);
    });
  };
  const sit = (seatNumber: number) => socket.emit("sutda.sit", { requestId: randomRequestId(), roomId, seatNumber }, (ack) => ack.ok ? setSnapshot(ack.data) : setMessage(ack.error));
  const ready = () => socket.emit("sutda.ready", { roomId, ready: !mine?.ready }, (ack) => ack.ok ? setSnapshot(ack.data) : setMessage(ack.error));
  const stand = () => socket.emit("sutda.standUp", { roomId }, (ack) => ack.ok ? setSnapshot(ack.data) : setMessage(ack.error));

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`삥 ${snapshot.room.minBet} · 최대 ${snapshot.room.maxBet} · 2–6인 PvP`}
      phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot)}
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={fullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
    >
      <OrientationGate targetRef={shellRef} />
      {/* Same two-column shell as Hold'em v4 (holdem-room-shell): table left, action rail
          right, at every viewport — the rail narrows on mobile rather than moving to a
          bottom bar. The layout system in table-holdem.css is deliberately shared between
          the two PvP card games. */}
      <div className="room-shell holdem-room-shell sutda-shell">
        <section className="ot-stage">
          <div className="ot-felt holdem-felt sutda-felt">
            <RoundResultNotice notice={resultNotice} />
            <div className="holdem-table">
              {/* The hwatu deck on the felt — also the [data-deck-shoe] anchor every dealt
                  card visibly flies out of (lib/shoeFlight). */}
              <div className="sutda-deck" data-deck-shoe aria-hidden="true">
                <span className="hwatu-card hwatu-back" />
                <span className="hwatu-card hwatu-back" />
              </div>
              <div className="holdem-table-rail" aria-hidden="true" />
              <div className="holdem-action-line" aria-hidden="true" />
              <div className="holdem-table-brand" aria-hidden="true">사인방 섯다</div>
              <div className="holdem-board">
                <div className="holdem-pot">{snapshot.pot.amount > 0 && <span>팟 {snapshot.pot.amount.toLocaleString()}</span>}</div>
                {snapshot.street && snapshot.street !== "showdown" && (
                  <div className="sutda-street">{snapshot.street === "first" ? "첫 패 베팅" : "둘째 패 베팅"}</div>
                )}
                {snapshot.lastWinners.length > 0 && (
                  <div className="holdem-winners">
                    {snapshot.lastWinners.map((winner) => (
                      <span key={winner.seatNumber} className="holdem-winner-pill">
                        {winner.username} +{winner.amount.toLocaleString()} ({winner.handLabel})
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {ordered(snapshot.seats, snapshot.mySeatNumber).map(({ seat, angle }) => (
                <Seat
                  key={seat.seatNumber}
                  seat={seat}
                  angle={angle}
                  canSit={!mine && !seat.userId}
                  onSit={() => sit(seat.seatNumber)}
                  isMine={seat.seatNumber === snapshot.mySeatNumber}
                  showReady={snapshot.room.phase === "WAITING"}
                  winnerLabel={winnerBySeat.get(seat.seatNumber) ? `WIN +${winnerBySeat.get(seat.seatNumber)!.amount.toLocaleString()}` : null}
                />
              ))}
              {myTurn && (
                <div className="ot-timer holdem-timer">
                  <svg viewBox="0 0 60 60"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} /></svg>
                  <span className="ot-timer-num">{seconds}</span>
                </div>
              )}
            </div>
            {message && <p className="ot-message">{message}</p>}
          </div>

          <aside className="holdem-rail-v4" aria-label="섯다 액션">
            {/* My live 족보 — the server already evaluates my own two-card hand (handLabel);
                with one card the read is honest about being incomplete. Private by nature:
                the label is only ever computed for the viewer's own seat. */}
            {mine && mine.cards && mine.cards.length > 0 && (
              <div className={`holdem-hand-panel ${mine.handLabel ? "" : "is-hint"}`}>
                <header>
                  <span className="holdem-hand-panel-eyebrow">내 족보</span>
                  <span className="holdem-hand-panel-private">나만 보여요</span>
                </header>
                <div className="holdem-hand-panel-body">
                  <div className="holdem-hand-panel-cards sutda-panel-cards" aria-hidden="true">
                    {mine.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
                  </div>
                  <div className="holdem-hand-panel-text">
                    <strong>{mine.handLabel ?? "첫 패"}</strong>
                    <span>{mine.handLabel ? "두 장 확정" : "둘째 패를 기다리는 중"}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="holdem-rail-meta">
              <span>팟 <b>{snapshot.pot.amount.toLocaleString()}</b></span>
              {myTurn && toCall > 0 && <span>콜 <b className="gold">{toCall.toLocaleString()}</b></span>}
            </div>

            {mine && myTurn && (
              <div className="holdem-act-row">
                <button className="outline-button bj-act-surrender" onClick={() => command("die")}>다이</button>
                {toCall === 0
                  ? <button className="outline-button bj-act-stand" onClick={() => command("check")}>체크</button>
                  : <button className="outline-button bj-act-double" onClick={() => command("call")}>콜 {toCall.toLocaleString()}</button>}
                {halfRaise > 0 && <button className="outline-button bj-act-hit" onClick={() => command("half")}>하프 +{(toCall + halfRaise).toLocaleString()}</button>}
              </div>
            )}

            {!myTurn && snapshot.room.phase !== "WAITING" && (
              <p className="holdem-rail-status">{railStatus(snapshot)}</p>
            )}

            {mine && !myTurn && snapshot.room.phase === "WAITING" && (
              <div className="holdem-ready-dock">
                <span className="holdem-ready-status">{readyCount}/{seated}명 준비 완료</span>
                <button type="button" className={`outline-button ${mine.ready ? "bj-act-surrender" : "bj-act-hit"}`} onClick={ready}>
                  {mine.ready ? "준비 취소" : "준비 완료"}
                </button>
              </div>
            )}

            <div className="holdem-rail-spacer" />

            <div className="holdem-rail-footer">
              <SutdaHandGuide />
              {mine && (
                <button type="button" className="outline-button" onClick={stand} disabled={Boolean(snapshot.roundId && !mine.folded)}>
                  자리 비우기
                </button>
              )}
              <RoomChat socket={socket} roomId={roomId} token={token} />
            </div>
          </aside>
        </section>
      </div>
    </GameShell>
  );
}

function ordered(seats: SutdaSeatSnapshot[], mine: number | null) {
  const rotate = mine ? mine - 1 : 0;
  return seats.map((seat, index) => ({ seat, angle: SEAT_ANGLES[(index - rotate + seats.length) % seats.length]! }));
}

function Seat({ seat, angle, canSit, onSit, isMine, showReady, winnerLabel }: { seat: SutdaSeatSnapshot; angle: number; canSit: boolean; onSit: () => void; isMine: boolean; showReady: boolean; winnerLabel: string | null }) {
  const x = 50 + 44 * Math.cos((angle * Math.PI) / 180);
  const y = 50 + 33 * Math.sin((angle * Math.PI) / 180);
  const style = { left: `${x}%`, top: `${y}%` };
  if (!seat.userId) {
    return canSit ? (
      <button className="holdem-seat holdem-seat-empty" style={style} onClick={onSit} aria-label={`${seat.seatNumber}번 좌석 착석`}>
        <span>착석</span>
      </button>
    ) : <div className="holdem-seat holdem-seat-empty" style={style} />;
  }
  return (
    <div className={`holdem-seat sutda-seat ${isMine ? "is-mine" : ""} ${seat.isTurn ? "is-turn" : ""} ${seat.folded ? "is-folded" : ""} ${seat.sittingOut ? "is-away" : ""} ${winnerLabel ? "is-winner" : ""}`} style={style}>
      <div className="holdem-seat-cards sutda-cards">
        {/* Faces for my own seat (and everyone's at showdown); otherwise exactly as many
            backs as the seat actually holds — 섯다 deals one card, bets, then the second,
            and the old markup drew two backs for every occupied seat including undealt
            ones sitting through WAITING. */}
        {seat.cards
          ? seat.cards.map((card, index) => <FlyingHwatu key={card.id} delayMs={index * 200}><HwatuCard card={card} /></FlyingHwatu>)
          : Array.from({ length: seat.cardCount }).map((_, index) => <FlyingHwatu key={index} delayMs={index * 200}><HwatuCard hidden /></FlyingHwatu>)}
      </div>
      <div className="holdem-seat-plate">
        <div className="holdem-seat-name">
          {seat.isDealer && <span className="holdem-button-chip">D</span>}
          <span className="holdem-seat-nick" title={seat.username ?? undefined}>{seat.username}</span>
          {showReady && <span className={`holdem-ready-dot ${seat.ready ? "is-ready" : ""}`} title={seat.ready ? "준비 완료" : "준비 대기"} />}
        </div>
        <div className="holdem-seat-stack">{seat.stack.toLocaleString()}</div>
      </div>
      <ChipStack amount={seat.totalContributed} label="베팅" />
      {seat.folded && <div className="holdem-seat-status fold">다이</div>}
      {winnerLabel && <div className="holdem-seat-status win">{winnerLabel}</div>}
      {!seat.folded && !winnerLabel && seat.handLabel && !isMine && (
        <div className="holdem-seat-status">{seat.handLabel}</div>
      )}
    </div>
  );
}

/**
 * Deals the wrapped hwatu card out of the on-felt deck: measures the flight on mount
 * (lib/shoeFlight caches per element, so re-renders never re-deal) and staggers via the
 * shared --card-enter-delay hook.
 */
function FlyingHwatu({ delayMs, children }: { delayMs: number; children: React.ReactNode }) {
  return (
    <span
      className="sutda-fly"
      ref={(el) => void applyShoeFlight(el)}
      style={{ "--card-enter-delay": `${delayMs}ms` } as CSSProperties}
    >
      {children}
    </span>
  );
}

function railStatus(snapshot: SutdaRoomSnapshot): string {
  if (snapshot.room.phase === "DEALING") return snapshot.street === "final" ? "둘째 패를 나눠주고 있습니다" : "첫 패를 나눠주고 있습니다";
  if (snapshot.room.phase === "RESULT") return "패를 비교하고 있습니다";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님의 차례입니다`;
  return "다른 자리의 선택을 기다리고 있습니다";
}

function phaseLabel(snapshot: SutdaRoomSnapshot): string {
  if (snapshot.room.phase === "PLAYER_TURN") return "베팅 진행 중";
  if (snapshot.room.phase === "DEALING") return snapshot.street === "final" ? "둘째 패 배분" : "첫 패 배분";
  if (snapshot.room.phase === "RESULT") return "승부 결과";
  return "플레이어 대기";
}
