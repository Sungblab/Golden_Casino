import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { CasinoHoldemRoomSnapshot, ClientToServerEvents, ServerToClientEvents } from "@golden/contracts";
import { API_URL } from "../api";
import { Brand } from "../components/Brand";
import { ChipStack } from "../components/ChipStack";
import { GameShell } from "../components/GameShell";
import { PlayingCard } from "../components/PlayingCard";
import { PokerHandGuide } from "../components/PokerHandGuide";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { playSound } from "../lib/sound";

const DECISION_SECONDS = 20;
const TIMER_RING = 163.4;

const OUTCOME_LABEL: Record<string, string> = { win: "승리", lose: "패배", push: "푸시", fold: "폴드" };
const HAND_LABEL: Record<string, string> = {
  high_card: "하이카드", pair: "원페어", two_pair: "투페어", three_of_a_kind: "트리플",
  straight: "스트레이트", flush: "플러시", full_house: "풀하우스", four_of_a_kind: "포카드", straight_flush: "스트레이트 플러시",
};

export function CasinoHoldemRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<CasinoHoldemRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [ante, setAnte] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const noticeHandRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(API_URL, { auth: { token }, autoConnect: false }),
    [token],
  );

  useEffect(() => {
    const accept = (next: CasinoHoldemRoomSnapshot) => setSnapshot(next);
    const onConnect = () => socket.emit("casinoHoldem.join", { roomId }, (ack) => ack.ok ? accept(ack.data) : setMessage(ack.error));
    const onWallet = ({ balance }: { balance: number }) => setSnapshot((current) => current ? { ...current, walletBalance: balance } : current);
    const onConnectError = (error: Error) => error.message === "UNAUTHORIZED"
      ? window.dispatchEvent(new Event("golden:session-expired"))
      : setMessage("게임 서버에 연결할 수 없습니다.");
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("casinoHoldem.snapshot", accept);
    socket.on("wallet.updated", onWallet);
    socket.connect();
    return () => {
      socket.emit("casinoHoldem.leave", { roomId }, () => undefined);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("casinoHoldem.snapshot", accept);
      socket.off("wallet.updated", onWallet);
      socket.disconnect();
    };
  }, [roomId, socket]);

  useEffect(() => {
    const update = () => setSeconds(snapshot?.hand.decisionEndsAt ? Math.max(0, Math.ceil((Date.parse(snapshot.hand.decisionEndsAt) - Date.now()) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [snapshot?.hand.decisionEndsAt]);

  useEffect(() => {
    if (snapshot && ante === 0) setAnte(snapshot.room.minBet);
  }, [snapshot, ante]);

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Deal-in / result cues.
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.hand.phase === "DECISION" && snapshot.hand.holeCards) playSound("deal");
  }, [snapshot?.hand.handId, snapshot?.hand.phase]);

  useEffect(() => {
    const hand = snapshot?.hand;
    if (!hand?.handId || hand.phase !== "RESULT" || !hand.result || noticeHandRef.current === hand.handId) return;
    noticeHandRef.current = hand.handId;
    const net = hand.result.netProfit;
    const totalReturned = hand.result.antePayout + hand.result.callPayout + hand.result.bonusPayout;
    setResultNotice({
      net,
      amount: net >= 0 ? totalReturned : net,
      title: net > 0 ? "승리했습니다" : net < 0 ? "패배했습니다" : "무승부",
    });
    playSound(net > 0 ? "win" : net < 0 ? "lose" : "chip");
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), 5200);
  }, [snapshot]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;

  const { hand, room } = snapshot;
  const bigBetLimit = room.maxBet;
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / DECISION_SECONDS));

  const placeBet = () => {
    if (busy || ante <= 0) return;
    setBusy(true);
    socket.emit("casinoHoldem.bet", { requestId: crypto.randomUUID(), roomId, ante, bonus: bonus > 0 ? bonus : undefined }, (ack) => {
      setBusy(false);
      if (ack.ok) { setSnapshot(ack.data); playSound("chip"); } else setMessage(ack.error);
    });
  };

  const decide = (decision: "call" | "fold") => {
    if (busy || !hand.handId) return;
    setBusy(true);
    socket.emit("casinoHoldem.decide", { requestId: crypto.randomUUID(), roomId, handId: hand.handId, decision }, (ack) => {
      setBusy(false);
      if (ack.ok) { setSnapshot(ack.data); playSound(decision === "fold" ? "fold" : "chip"); } else setMessage(ack.error);
    });
  };

  const idle = hand.phase === "IDLE";
  const deciding = hand.phase === "DECISION";
  const showdown = hand.phase === "RESULT";

  return (
    <GameShell
      title={room.name}
      subtitle={`ANTE ${room.minBet}~${room.maxBet} · CALL 2x`}
      phaseLabel={room.paused ? "일시정지" : idle ? "베팅 대기" : deciding ? "콜 / 폴드" : "결과"}
      phaseSeconds={deciding ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
    >
      <div className="room-shell">
        <section className="ot-stage">
          <div className="ot-felt holdem-felt casino-holdem-felt">
            <div className="ot-feed"><WinnerFeed socket={socket} /></div>
            <RoundResultNotice notice={resultNotice} />
            <div className="ch-table">
              <div className="ch-dealer-row">
                <span className="ch-role-label">딜러</span>
                <div className="ch-cards">
                  {showdown && hand.result
                    ? hand.result.dealerCards.map((card, index) => <PlayingCard key={index} card={card} delayMs={index * 120} />)
                    : Array.from({ length: 2 }).map((_, index) => <span key={index} className="ot-card-slot" />)}
                </div>
                {showdown && hand.result && (
                  <span className={`ch-qualify ${hand.result.dealerQualified ? "ok" : "no"}`}>
                    {hand.result.dealerQualified ? "퀄리파이" : "퀄리파이 실패"}
                    {hand.result.dealerHandCategory && ` · ${HAND_LABEL[hand.result.dealerHandCategory]}`}
                  </span>
                )}
              </div>

              <div className="ch-board">
                {deciding && (
                  <div className="ot-timer holdem-timer">
                    <svg viewBox="0 0 60 60"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} /></svg>
                    <span className="ot-timer-num">{seconds}</span>
                  </div>
                )}
                {hand.board.map((card, index) => <PlayingCard key={index} card={card} delayMs={index * 120} />)}
                {Array.from({ length: 5 - hand.board.length }).map((_, index) => <span key={`slot-${index}`} className="ot-card-slot holdem-board-slot" />)}
              </div>

              <div className="ch-player-row">
                <div className="ch-cards">
                  {hand.holeCards
                    ? hand.holeCards.map((card, index) => <PlayingCard key={index} card={card} delayMs={index * 120} />)
                    : Array.from({ length: 2 }).map((_, index) => <span key={index} className="ot-card-slot" />)}
                </div>
                <span className="ch-role-label">나{showdown && hand.result?.playerHandCategory ? ` · ${HAND_LABEL[hand.result.playerHandCategory]}` : ""}</span>
              </div>

              <div className="ch-stakes">
                {hand.ante > 0 && <span className="ch-stake-item"><small>앤티</small><ChipStack amount={hand.ante} label="앤티" /></span>}
                {hand.bonus > 0 && <span className="ch-stake-item"><small>보너스</small><ChipStack amount={hand.bonus} label="보너스" /></span>}
                {hand.call > 0 && <span className="ch-stake-item"><small>콜</small><ChipStack amount={hand.call} label="콜" /></span>}
              </div>
            </div>

            {/* Betting lives on the felt itself, like PvP Hold'em's action dock — not a
                separate footer row, which pushed these controls off-screen on short viewports. */}
            {idle && (
              <div className="ch-bet-form on-felt">
                <label>
                  앤티
                  <input type="number" min={room.minBet} max={room.maxBet} step={1} value={ante}
                    onChange={(event) => setAnte(Math.max(room.minBet, Math.min(room.maxBet, Number(event.target.value) || 0)))} />
                </label>
                <label>
                  AA 보너스
                  <input type="number" min={0} max={bigBetLimit} step={1} value={bonus}
                    onChange={(event) => setBonus(Math.max(0, Math.min(bigBetLimit, Number(event.target.value) || 0)))} />
                </label>
                <button className="outline-button ch-deal" disabled={busy || ante < room.minBet} onClick={placeBet}>딜</button>
              </div>
            )}
            {deciding && (
              <div className="ch-decision on-felt">
                <button className="outline-button ch-fold" disabled={busy} onClick={() => decide("fold")}>폴드</button>
                <button className="outline-button ch-call" disabled={busy} onClick={() => decide("call")}>콜 ({(hand.ante * 2).toLocaleString()})</button>
              </div>
            )}
            {showdown && hand.result && (
              <div className="ch-result-breakdown on-felt">
                <span>앤티 {OUTCOME_LABEL[hand.result.anteOutcome]}</span>
                {hand.result.callOutcome && <span>콜 {OUTCOME_LABEL[hand.result.callOutcome]}</span>}
                {hand.result.bonusOutcome && <span>보너스 {OUTCOME_LABEL[hand.result.bonusOutcome]}</span>}
              </div>
            )}
          </div>
        </section>
        {/* No footer rail here at all — the felt already used the full-width overlay pattern
            for its own controls, so the rail existed only to hold this one button. */}
        <PokerHandGuide className="game-fab fab-slot-1" />
        <RoomChat socket={socket} roomId={roomId} token={token} />
      </div>
      {message && <p className="error-message ch-toast">{message}</p>}
    </GameShell>
  );
}
