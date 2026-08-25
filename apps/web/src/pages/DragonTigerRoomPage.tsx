import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  DragonTigerBetChoice,
  DragonTigerRoomSnapshot,
  ServerToClientEvents,
} from "@golden/contracts";
import { API_URL } from "../api";
import { Brand } from "../components/Brand";
import { BetZone } from "../components/BetZone";
import { GameShell } from "../components/GameShell";
import { PlayingCard } from "../components/PlayingCard";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { chipTier, chipValuesForRoom, maximumAdditionalBet } from "../lib/betting";

const BETTING_SECONDS = 12;
const TIMER_RING = 163.4;
const choices: DragonTigerBetChoice[] = ["dragon", "tiger", "tie", "suited_tie"];

export function DragonTigerRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<DragonTigerRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [chip, setChip] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
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

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;

  const betting = snapshot.room.phase === "BETTING";
  const currentBet = Object.values(snapshot.myBets).reduce((sum, value) => sum + value, 0);
  const maxAdditional = maximumAdditionalBet(snapshot.walletBalance, currentBet, snapshot.room.maxBet);
  const chips = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / BETTING_SECONDS));

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

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`MIN ${snapshot.room.minBet} · MAX ${snapshot.room.maxBet} · 8덱 · 남은 카드 ${snapshot.shoeRemaining}`}
      phaseLabel={snapshot.room.paused ? "일시정지" : phaseLabel(snapshot.room.phase)}
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
    >
      <div className="room-shell">
        <section className="ot-stage">
          <div className="ot-felt dragon-tiger-felt">
            <div className="ot-feed"><WinnerFeed socket={socket} /></div>
            <div className="ot-hands dragon-tiger-hands">
              <div className={`ot-hand player ${snapshot.result === "dragon" ? "won" : ""}`}>
                <div className="ot-hand-head">DRAGON</div>
                <div className="ot-cards">{snapshot.dragonCard ? <PlayingCard card={snapshot.dragonCard} /> : <span className="ot-card-slot">D</span>}</div>
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
            {snapshot.result && <div className={`ot-banner ${snapshot.result}`}>{snapshot.suitedTie ? "SUITED TIE" : snapshot.result.toUpperCase()} WIN</div>}
            <div className="ot-print dragon-tiger-print">
              <BetZone className="player" label="DRAGON" odds="1:1" amount={snapshot.myBets.dragon ?? 0} disabled={!betting} onPlace={() => place("dragon")} onCancel={() => cancel("dragon")} />
              <BetZone className="banker" label="TIGER" odds="1:1" amount={snapshot.myBets.tiger ?? 0} disabled={!betting} onPlace={() => place("tiger")} onCancel={() => cancel("tiger")} />
              <BetZone className="tie" label="TIE" odds="11:1" amount={snapshot.myBets.tie ?? 0} disabled={!betting} onPlace={() => place("tie")} onCancel={() => cancel("tie")} />
              <BetZone className="pair" label="SUITED TIE" odds="50:1" amount={snapshot.myBets.suited_tie ?? 0} disabled={!betting} onPlace={() => place("suited_tie")} onCancel={() => cancel("suited_tie")} />
            </div>
            {message && <p className="ot-message">{message}</p>}
          </div>
          <footer className="ot-rail">
            <div className="ot-tray">{chips.map((value) => <button key={value} className={`chip chip-option chip-tier-${chipTier(value)} ${chip === value ? "active" : ""}`} onClick={() => setChip(value)}>{value}</button>)}</div>
            <div className="ot-money right"><small>총 베팅</small><strong>{currentBet.toLocaleString()}</strong></div>
            {maxAdditional > 0 && !chips.includes(maxAdditional) && <button className="outline-button" disabled={!betting} onClick={() => setChip(maxAdditional)}>MAX {maxAdditional}</button>}
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
