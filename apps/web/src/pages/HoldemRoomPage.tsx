import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  HoldemAction,
  HoldemRoomSnapshot,
  HoldemSeatSnapshot,
  ServerToClientEvents,
} from "@golden/contracts";
import { API_URL } from "../api";
import { Brand } from "../components/Brand";
import { GameShell } from "../components/GameShell";
import { PlayingCard } from "../components/PlayingCard";
import { PokerHandGuide } from "../components/PokerHandGuide";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";

const ACTION_SECONDS = 20;
const TIMER_RING = 163.4;
// Seat layout around the oval, clockwise from the bottom (viewer's own seat is re-centered there).
const SEAT_ANGLES = [90, 150, 210, 270, 330, 30];

export function HoldemRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<HoldemRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [raiseTo, setRaiseTo] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(API_URL, { auth: { token }, autoConnect: false }),
    [token],
  );

  useEffect(() => {
    const accept = (next: HoldemRoomSnapshot) => setSnapshot((current) => !current || next.sequence >= current.sequence ? next : current);
    const onConnect = () => socket.emit("holdem.join", { roomId }, (ack) => ack.ok ? accept(ack.data) : setMessage(ack.error));
    const onWallet = ({ balance }: { balance: number }) => setSnapshot((current) => current ? { ...current, walletBalance: balance } : current);
    const onConnectError = (error: Error) => error.message === "UNAUTHORIZED"
      ? window.dispatchEvent(new Event("golden:session-expired"))
      : setMessage("게임 서버에 연결할 수 없습니다.");
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("holdem.snapshot", accept);
    socket.on("wallet.updated", onWallet);
    socket.connect();
    return () => {
      socket.emit("holdem.leave", { roomId }, () => undefined);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("holdem.snapshot", accept);
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
    const handler = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    setRaiseTo(Math.max(snapshot.minRaiseTo, snapshot.toCall * 2 || snapshot.minRaiseTo));
    // Recompute the default raise target whenever it becomes our turn again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.actingSeat, snapshot?.roundId, snapshot?.street]);

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;

  const mySeat = snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber) ?? null;
  const myTurn = snapshot.mySeatNumber !== null && snapshot.actingSeat === snapshot.mySeatNumber;
  const potTotal = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0);
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / ACTION_SECONDS));

  const sit = (seatNumber: number) => {
    socket.emit("holdem.sit", { requestId: crypto.randomUUID(), roomId, seatNumber }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };
  const standUp = () => {
    socket.emit("holdem.standUp", { roomId }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };
  const act = (action: HoldemAction, amount?: number) => {
    if (!snapshot.roundId) return;
    socket.emit("holdem.act", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, action, amount }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };

  const bigBlind = snapshot.room.minBet * 2;
  const maxRaiseTo = (mySeat?.stack ?? 0) + (mySeat?.streetContributed ?? 0);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`BLIND ${snapshot.room.minBet}/${bigBlind} · MAX ${snapshot.room.maxBet}`}
      phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot.room.phase, snapshot.street)}
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
    >
      <div className="room-shell">
        <section className="ot-stage">
          <div className="ot-felt holdem-felt">
            <div className="ot-feed"><WinnerFeed socket={socket} /></div>
            <div className="holdem-table">
              <div className="holdem-board">
                <div className="holdem-pot">{potTotal > 0 && <span>POT {potTotal.toLocaleString()}</span>}</div>
                <div className="holdem-board-cards">
                  {snapshot.board.map((card, index) => <PlayingCard key={index} card={card} delayMs={index * 120} />)}
                  {Array.from({ length: 5 - snapshot.board.length }).map((_, index) => <span key={`slot-${index}`} className="ot-card-slot holdem-board-slot" />)}
                </div>
                {snapshot.lastWinners.length > 0 && (
                  <div className="holdem-winners">
                    {snapshot.lastWinners.map((winner) => (
                      <span key={winner.seatNumber} className="holdem-winner-pill">
                        {winner.username} +{winner.amount.toLocaleString()}{winner.handCategory ? ` (${HAND_LABEL[winner.handCategory]})` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {orderedSeats(snapshot.seats, snapshot.mySeatNumber).map(({ seat, angle }) => (
                <SeatView key={seat.seatNumber} seat={seat} angle={angle} onSit={() => sit(seat.seatNumber)} canSit={!mySeat && !seat.userId} />
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
          <footer className="ot-rail holdem-rail">
            {mySeat && myTurn && (
              <div className="holdem-actions">
                <button className="outline-button" onClick={() => act("fold")}>폴드</button>
                {snapshot.toCall === 0
                  ? <button className="outline-button" onClick={() => act("check")}>체크</button>
                  : <button className="outline-button" onClick={() => act("call")}>콜 {Math.min(snapshot.toCall, mySeat.stack)}</button>}
                {maxRaiseTo > snapshot.toCall + mySeat.streetContributed && (
                  <div className="holdem-raise">
                    <input
                      type="range"
                      min={Math.min(snapshot.minRaiseTo, maxRaiseTo)}
                      max={maxRaiseTo}
                      value={Math.min(raiseTo, maxRaiseTo)}
                      onChange={(event) => setRaiseTo(Number(event.target.value))}
                    />
                    <button className="outline-button" onClick={() => act(snapshot.toCall === 0 ? "bet" : "raise", Math.min(raiseTo, maxRaiseTo))}>
                      {snapshot.toCall === 0 ? "베팅" : "레이즈"} {Math.min(raiseTo, maxRaiseTo)}
                    </button>
                  </div>
                )}
                {maxRaiseTo > 0 && <button className="outline-button" onClick={() => act("allin")}>올인 {maxRaiseTo}</button>}
              </div>
            )}
            {mySeat && !myTurn && <div className="ot-money right"><small>내 좌석</small><strong>{mySeat.stack.toLocaleString()}</strong></div>}
            {mySeat && <button className="outline-button" onClick={standUp} disabled={!!snapshot.roundId && mySeat.totalContributed > 0 && !mySeat.folded}>자리 비우기</button>}
            <PokerHandGuide />
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </footer>
        </section>
      </div>
    </GameShell>
  );
}

function orderedSeats(seats: HoldemSeatSnapshot[], mySeatNumber: number | null): Array<{ seat: HoldemSeatSnapshot; angle: number }> {
  const rotation = mySeatNumber ? mySeatNumber - 1 : 0;
  return seats.map((seat, index) => ({ seat, angle: SEAT_ANGLES[(index - rotation + seats.length) % seats.length]! }));
}

function SeatView({ seat, angle, onSit, canSit }: { seat: HoldemSeatSnapshot; angle: number; onSit: () => void; canSit: boolean }) {
  const radius = 42;
  const x = 50 + radius * Math.cos((angle * Math.PI) / 180);
  const y = 50 + radius * Math.sin((angle * Math.PI) / 180) * 0.72;
  const style = { left: `${x}%`, top: `${y}%` };
  if (!seat.userId) {
    return canSit ? (
      <button className="holdem-seat holdem-seat-empty" style={style} onClick={onSit}>
        <span>착석</span>
      </button>
    ) : <div className="holdem-seat holdem-seat-empty" style={style} />;
  }
  return (
    <div className={`holdem-seat ${seat.isTurn ? "is-turn" : ""} ${seat.folded ? "is-folded" : ""} ${seat.sittingOut ? "is-away" : ""}`} style={style}>
      <div className="holdem-seat-cards">
        {seat.holeCards
          ? seat.holeCards.map((card, index) => <PlayingCard key={index} card={card} animate={false} />)
          : Array.from({ length: 2 }).map((_, index) => <span key={index} className="ot-card-slot holdem-hole-slot" />)}
      </div>
      <div className="holdem-seat-name">
        {seat.isButton && <span className="holdem-button-chip">D</span>}
        {seat.username}
      </div>
      <div className="holdem-seat-stack">{seat.stack.toLocaleString()}</div>
      {seat.streetContributed > 0 && <div className="holdem-seat-bet">{seat.streetContributed.toLocaleString()}</div>}
      {seat.folded && <div className="holdem-seat-status">폴드</div>}
      {seat.allIn && !seat.folded && <div className="holdem-seat-status">올인</div>}
      {seat.handCategory && !seat.folded && <div className="holdem-seat-status">{HAND_LABEL[seat.handCategory]}</div>}
    </div>
  );
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

function phaseLabel(phase: HoldemRoomSnapshot["room"]["phase"], street: HoldemRoomSnapshot["street"]): string {
  if (phase === "PLAYER_TURN") return "베팅 진행 중";
  if (phase === "DEALING") return street === "preflop" || !street ? "카드 딜링" : `${STREET_LABEL[street] ?? street} 오픈`;
  if (phase === "SETTLING") return "쇼다운";
  if (phase === "RESULT") return "핸드 종료";
  return "플레이어 대기";
}

const STREET_LABEL: Record<string, string> = { preflop: "프리플랍", flop: "플랍", turn: "턴", river: "리버", showdown: "쇼다운" };
