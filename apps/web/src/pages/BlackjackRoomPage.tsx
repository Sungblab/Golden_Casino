import { useEffect, useMemo, useRef, useState } from "react";
import { Armchair, Flame, LogOut, Users } from "lucide-react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type {
  BlackjackAction,
  BlackjackOutcome,
  BlackjackPlayerHand,
  BlackjackRoomSnapshot,
  BlackjackSeatSnapshot,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@golden/contracts";
import { handValue } from "@golden/game-core/blackjack";
import { API_URL } from "../api";
import { GameShell } from "../components/GameShell";
import { Brand } from "../components/Brand";
import { CardBackFace } from "../components/CardFace";
import { PlayingCard } from "../components/PlayingCard";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { playSound } from "../lib/sound";
import { chipTier, chipValuesForRoom, maximumAdditionalBet } from "../lib/betting";

const BETTING_SECONDS = 12;
const TIMER_RING = 163.4;

const OUTCOME_LABEL: Record<BlackjackOutcome, string> = {
  win: "승리",
  lose: "패배",
  push: "푸시",
  blackjack: "블랙잭",
  surrender: "서렌더",
};

export function BlackjackRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<BlackjackRoomSnapshot | null>(null);
  const [chip, setChip] = useState(1);
  const [chipMenuOpen, setChipMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const lastCardCountRef = useRef(0);
  const noticeRoundRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () => io(API_URL, { auth: { token }, autoConnect: false }),
    [token],
  );

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
    const acceptSnapshot = (next: BlackjackRoomSnapshot) => {
      setSnapshot((current) => (!current || next.sequence >= current.sequence ? next : current));
      setSelectedSeat((current) => current ?? next.mySeat);
    };
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
    if (!snapshot) return;
    const allowed = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
    setChip((current) => (allowed.includes(current) ? current : allowed[0]!));
  }, [snapshot?.room.minBet, snapshot?.room.maxBet]);

  useEffect(() => {
    if (snapshot?.room.phase === "LOCKED") setMessage("");
  }, [snapshot?.room.phase, snapshot?.roundId]);

  useEffect(() => {
    if (!snapshot?.mySeat) return;
    setSelectedSeat((current) => {
      if (current === null) return snapshot.mySeat;
      const currentSeat = snapshot.seats[current - 1];
      return currentSeat?.userId ? current : snapshot.mySeat;
    });
    setMessage((current) => current === "이미 다른 좌석에 앉아 있습니다." ? "" : current);
  }, [snapshot?.mySeat, snapshot?.seats]);

  useEffect(() => {
    if (!snapshot?.roundId) return;
    const nextCount = snapshot.dealerCards.length + snapshot.hands.reduce((sum, hand) => sum + hand.cards.length, 0);
    if (nextCount > lastCardCountRef.current) playSound("deal");
    lastCardCountRef.current = snapshot.room.phase === "BETTING" ? 0 : nextCount;
  }, [snapshot]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!snapshot?.roundId || snapshot.room.phase !== "RESULT" || noticeRoundRef.current === snapshot.roundId) return;
    const outcomes = [
      ...snapshot.myHands.filter((hand) => hand.outcome).map((hand) => ({ outcome: hand.outcome!, amount: hand.bet, lightning: true })),
      ...snapshot.behindBets.filter((bet) => bet.outcome).map((bet) => ({ outcome: bet.outcome!, amount: bet.amount, lightning: false })),
    ];
    const insuranceNet = snapshot.myInsurance?.outcome === "win" ? snapshot.myInsurance.amount * 2 : snapshot.myInsurance?.outcome === "lose" ? -snapshot.myInsurance.amount : 0;
    if (outcomes.length === 0 && !snapshot.myInsurance?.outcome) return;
    noticeRoundRef.current = snapshot.roundId;
    const multiplier = snapshot.activeLightningMultiplier ?? 1;
    const fee = snapshot.lightningFeePercent === 100 ? (snapshot.myHands[0]?.bet ?? 0) : 0;
    const net = outcomes.reduce((sum, entry) => {
      const base = netForOutcome(entry.outcome, entry.amount);
      return sum + (entry.lightning && base > 0 ? base * multiplier : base);
    }, insuranceNet - fee);
    // Total coins staked this round across every hand/behind bet/insurance/fee — combined with
    // net profit, this gives the total credited back on a win ("+100" for a 50-coin bet that
    // wins even money), rather than just the profit portion ("+50"), which reads as a smaller win.
    const totalStaked = outcomes.reduce((sum, entry) => sum + entry.amount, 0) + (snapshot.myInsurance?.amount ?? 0) + fee;
    setResultNotice({ net, amount: net > 0 ? totalStaked + net : net, title: net > 0 ? "승리했습니다" : net < 0 ? "아쉽게 패배했습니다" : "푸시 · 베팅금 반환" });
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), 3600);
  }, [snapshot]);

  if (!snapshot) {
    return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;
  }

  const accept = (next: BlackjackRoomSnapshot, nextMessage?: string) => {
    setSnapshot((current) => (!current || next.sequence >= current.sequence ? next : current));
    if (nextMessage) setMessage(nextMessage);
  };
  const claimSeat = (seatNumber: number) => {
    socket.emit("blackjack.seat.claim", { roomId, seatNumber }, (ack) => {
      if (ack.ok) { accept(ack.data, `${seatNumber}번 좌석에 앉았습니다.`); setSelectedSeat(seatNumber); }
      else setMessage(ack.error);
    });
  };
  const leaveSeat = () => {
    socket.emit("blackjack.seat.leave", { roomId }, (ack) => {
      if (ack.ok) { accept(ack.data, "관전 모드로 전환했습니다."); setSelectedSeat(null); }
      else setMessage(ack.error);
    });
  };
  const placeMainBet = () => {
    if (!snapshot.roundId) return;
    if (snapshot.mySeat) setSelectedSeat(snapshot.mySeat);
    socket.emit("blackjack.bet", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, amount: chip }, (ack) => {
      if (ack.ok) { accept(ack.data, `${chip}코인 본 베팅 완료`); playSound("chip"); }
      else setMessage(ack.error);
    });
  };
  const placeBehind = (targetSeat: number) => {
    if (!snapshot.roundId) return;
    socket.emit("blackjack.betBehind", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, targetSeat, amount: chip }, (ack) => {
      if (ack.ok) { accept(ack.data, `${targetSeat}번 좌석에 ${chip}코인 따라 베팅 완료`); playSound("chip"); }
      else setMessage(ack.error);
    });
  };
  const act = (action: BlackjackAction) => {
    if (!snapshot.roundId || !snapshot.myHand) return;
    socket.emit("blackjack.action", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId, handId: snapshot.myHand.handId, action }, (ack) => {
      if (ack.ok) accept(ack.data);
      else setMessage(ack.error);
    });
  };
  const takeInsurance = () => {
    if (!snapshot.roundId) return;
    socket.emit("blackjack.insurance", { requestId: crypto.randomUUID(), roomId, roundId: snapshot.roundId }, (ack) => {
      if (ack.ok) { accept(ack.data, `보험 ${ack.data.myInsurance?.amount ?? 0}코인 가입 완료`); playSound("chip"); }
      else setMessage(ack.error);
    });
  };

  const betting = snapshot.room.phase === "BETTING";
  const insurancePhase = snapshot.room.phase === "INSURANCE";
  const myTurn = snapshot.room.phase === "PLAYER_TURN" && snapshot.myHand?.status === "playing";
  const selected = selectedSeat ? (snapshot.seats[selectedSeat - 1] ?? null) : null;
  const selectedIsMine = selected?.seatNumber === snapshot.mySeat;
  const selectedCanFollow = Boolean(selected?.userId && selected.hand && !selectedIsMine && selected.myBehindBet < snapshot.room.maxBet);
  const canMainBet = Boolean(snapshot.mySeat && (snapshot.myHand?.bet ?? 0) < snapshot.room.maxBet);
  const chipValues = chipValuesForRoom(snapshot.room.minBet, snapshot.room.maxBet);
  const selectedBet = selectedCanFollow ? (selected?.myBehindBet ?? 0) : (snapshot.myHand?.bet ?? 0);
  const affordableWallet = snapshot.lightningFeePercent === 100 && !selectedCanFollow ? Math.floor(snapshot.walletBalance / 2) : snapshot.walletBalance;
  const maxAdditional = maximumAdditionalBet(affordableWallet, selectedBet, snapshot.room.maxBet);
  const dealerLiveScore = snapshot.dealerCards.length > 0 ? handValue(snapshot.dealerCards).total : null;
  const canDouble = Boolean(myTurn && snapshot.myHand?.cards.length === 2 && !snapshot.myHand.fromSplit && snapshot.walletBalance >= snapshot.myHand.bet);
  const canSplit = Boolean(myTurn && snapshot.myHand && snapshot.myHands.length < 4 && !snapshot.myHand.splitAces && snapshot.myHand.cards.length === 2 && cardPoint(snapshot.myHand.cards[0]!) === cardPoint(snapshot.myHand.cards[1]!) && snapshot.walletBalance >= snapshot.myHand.bet);
  const canSurrender = Boolean(myTurn && snapshot.myHand?.cards.length === 2 && !snapshot.myHand.fromSplit && snapshot.myHands.length === 1 && snapshot.myHand.bet % 2 === 0);
  const insuranceAmount = snapshot.myHand ? Math.floor(snapshot.myHand.bet / 2) : 0;
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / BETTING_SECONDS));
  const lightningFeeTotal = snapshot.lightningFeePercent === 100 ? (snapshot.myHands[0]?.bet ?? 0) : 0;
  const totalRisk = snapshot.myHands.reduce((sum, hand) => sum + hand.bet, 0) + snapshot.behindBets.reduce((sum, bet) => sum + bet.amount, 0) + (snapshot.myInsurance?.amount ?? 0) + lightningFeeTotal;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`MIN ${snapshot.room.minBet} · MAX ${snapshot.room.maxBet} · 남은 카드 ${snapshot.shoeRemaining}`}
      phaseLabel={snapshot.room.paused ? "일시정지" : blackjackPhaseLabel(snapshot.room.phase)}
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void toggleFullscreen()}
      shellRef={shellRef}
    >
      <div className="room-shell bj-room-shell">
        <section className="ot-stage bj-stage">
          <div className={`ot-felt bj bj-phase-${snapshot.room.phase.toLowerCase()}`}>
            <div className="ot-feed bj-feed"><WinnerFeed socket={socket} /></div>
            <div className="bj-table-meta"><span><Users size={14} /> 좌석 {snapshot.room.playerCount}/7</span><span>관전 {snapshot.spectatorCount}</span></div>
            {snapshot.room.gameType === "lightning_blackjack" && <div className="bj-lightning-status">
              <strong>LIGHTNING BLACKJACK</strong>
              <span>최초 베팅 수수료 100%</span>
              <b>{snapshot.activeLightningMultiplier && snapshot.activeLightningMultiplier > 1 ? `이번 라운드 ×${snapshot.activeLightningMultiplier}` : "기본 배당"}</b>
              {snapshot.nextLightningMultiplier && <em>다음 라운드 ×{snapshot.nextLightningMultiplier}</em>}
            </div>}
            <div className="ot-dealer-row bj-dealer-row">
              <div className="ot-hand dealer">
                <div className="ot-hand-head">DEALER <span className="ot-score">{snapshot.dealerHoleHidden ? "?" : (dealerLiveScore ?? 0)}</span></div>
                <div className="ot-cards">
                  {snapshot.dealerCards.length === 0 && <span className="ot-card-slot">D</span>}
                  {snapshot.dealerCards.map((cardEntry, index) => <PlayingCard key={`dealer-${index}`} card={cardEntry} />)}
                  {snapshot.dealerHoleHidden && snapshot.dealerCards.length > 0 && <span className="playing-card"><span className="playing-card-inner"><span className="playing-card-back"><CardBackFace /></span></span></span>}
                </div>
              </div>
            </div>
            <div className="bj-table-rules" aria-label="블랙잭 테이블 규칙"><strong>BLACKJACK PAYS 3 TO 2</strong><span>DEALER STANDS ON ALL 17 · INSURANCE PAYS 2 TO 1</span><small>SPLIT TO 4 HANDS · SPLIT ACES ONE CARD · NO DOUBLE AFTER SPLIT · LATE SURRENDER</small></div>
            {betting && (
              <div className={`ot-timer bj-timer ${seconds <= 4 ? "closing" : ""}`} aria-label={`베팅 마감 ${seconds}초`}>
                <svg viewBox="0 0 60 60" aria-hidden="true"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} /></svg>
                <span className="ot-timer-num">{seconds}</span>
              </div>
            )}
            <RoundResultNotice notice={resultNotice} />
            <div className="bj-seat-grid" aria-label="블랙잭 좌석">
              {snapshot.seats.map((seat) => <BlackjackSeat key={seat.seatNumber} seat={seat} isMine={seat.seatNumber === snapshot.mySeat} isSelected={seat.seatNumber === selectedSeat} canClaim={!snapshot.mySeat} onClaim={() => claimSeat(seat.seatNumber)} onSelect={() => setSelectedSeat(seat.seatNumber)} />)}
            </div>
            {message && <div className="bj-table-message" aria-live="polite">{message}</div>}
          </div>

          <footer className="ot-rail bj-rail">
            <div className="bj-seat-control">
              {snapshot.mySeat ? <><span><strong>{snapshot.mySeat}</strong>번 좌석</span><button type="button" className="icon-action" onClick={leaveSeat} aria-label="좌석 나가기" disabled={snapshot.myHands.length > 0}><LogOut size={17} /></button></> : <span className="bj-spectator-label"><Armchair size={17} /> 빈 좌석을 선택하세요</span>}
            </div>
            {betting ? (
              <div className="bj-bet-dock">
                <div className="ot-tray">{chipValues.map((value) => <button key={value} className={`chip chip-option chip-tier-${chipTier(value)} ${chip === value ? "active" : ""}`} onClick={() => setChip(value)}>{value}</button>)}{!chipValues.includes(maxAdditional) && <button type="button" className={`chip chip-option chip-max ${chip === maxAdditional ? "active" : ""}`} disabled={maxAdditional <= 0 || (selectedBet === 0 && maxAdditional < snapshot.room.minBet)} onClick={() => setChip(maxAdditional)} title={`가능한 최대 금액 ${maxAdditional}코인`}>{maxAdditional}</button>}<button type="button" className={`chip-picker-trigger chip-tier-${chipTier(chip)}`} aria-label="칩 단위 선택" aria-expanded={chipMenuOpen} onClick={() => setChipMenuOpen((open) => !open)}>{chip}</button>{chipMenuOpen && <div className="chip-picker-menu" role="menu">{[...chipValues, ...(!chipValues.includes(maxAdditional) && maxAdditional > 0 ? [maxAdditional] : [])].map((value) => <button type="button" role="menuitem" key={value} className={`chip-tier-${chipTier(value)} ${chip === value ? "selected" : ""}`} onClick={() => { setChip(value); setChipMenuOpen(false); }}>{value}</button>)}</div>}</div>
                {selectedCanFollow ? <button type="button" className="bet-confirm-button follow" disabled={chip > maxAdditional} onClick={() => placeBehind(selected!.seatNumber)}>{selected!.seatNumber}번 +{chip}</button>
                  : canMainBet && (!selected || selectedIsMine) ? <button type="button" className="bet-confirm-button" disabled={chip > maxAdditional} onClick={placeMainBet}>{chip}코인 {snapshot.myHand ? "추가 베팅" : "베팅"}</button>
                    : selected?.myBehindBet ? <span className="bj-dock-status">{selected.seatNumber}번 · {selected.myBehindBet}코인 완료</span>
                      : snapshot.myHand ? <span className="bj-dock-status">본 베팅 {snapshot.myHand.bet}코인 · 다른 좌석을 눌러 따라 베팅</span>
                        : <span className="bj-dock-status">{selected?.userId ? "본 베팅을 기다리는 좌석입니다" : "빈 좌석 또는 플레이어를 선택하세요"}</span>}
              </div>
            ) : insurancePhase ? (
              <div className="bj-insurance-dock"><span>딜러 A · 보험은 본 베팅의 절반(정수 코인)</span>{snapshot.myInsurance ? <strong>보험 {snapshot.myInsurance.amount}코인 완료</strong> : snapshot.myHand ? <button type="button" className="bet-confirm-button insurance" disabled={insuranceAmount < 1 || snapshot.walletBalance < insuranceAmount} onClick={takeInsurance}>{insuranceAmount < 1 ? "보험 이용 불가" : `보험 ${insuranceAmount}코인`}</button> : null}</div>
            ) : myTurn ? (
              <div className="ot-acts bj-actions" aria-label="블랙잭 액션"><span className="bj-live-total">{snapshot.myHands.length > 1 ? `패 ${snapshot.myHand!.handIndex + 1}` : "합계"} <strong>{handValue(snapshot.myHand!.cards).total}</strong></span><button type="button" className="outline-button primary" onClick={() => act("hit")}>히트</button><button type="button" className="outline-button" onClick={() => act("stand")}>스탠드</button><button type="button" className="outline-button" disabled={!canDouble} onClick={() => act("double")}>더블</button><button type="button" className="outline-button" disabled={!canSplit} onClick={() => act("split")}>스플릿</button><button type="button" className="outline-button danger" disabled={!canSurrender} onClick={() => act("surrender")}>서렌더</button></div>
            ) : <div className="bj-phase-guide">{phaseGuide(snapshot, selected)}</div>}
            <div className="ot-money right bj-total-risk"><small>{snapshot.lightningFeePercent === 100 ? "베팅 + 수수료" : "총 베팅"}</small><strong>{totalRisk.toLocaleString()}</strong></div>
            <RoomChat socket={socket} roomId={roomId} token={token} />
          </footer>
        </section>
      </div>
    </GameShell>
  );
}

function BlackjackSeat({ seat, isMine, isSelected, canClaim, onClaim, onSelect }: { seat: BlackjackSeatSnapshot; isMine: boolean; isSelected: boolean; canClaim: boolean; onClaim: () => void; onSelect: () => void }) {
  if (!seat.userId) {
    return (
      <button type="button" className={`bj-seat empty ${isSelected ? "selected" : ""}`} onClick={onClaim} disabled={!canClaim} aria-label={`${seat.seatNumber}번 빈 좌석에 앉기`}>
        <span className="bj-seat-number">{seat.seatNumber}</span>
        <span className="bj-seat-empty-mark"><Armchair size={16} aria-hidden="true" /></span>
      </button>
    );
  }
  const total = seat.hand?.cards.length ? handValue(seat.hand.cards).total : 0;
  const cardCount = seat.hand?.cards.length ?? 0;
  const totalBet = seat.hands.reduce((sum, hand) => sum + hand.bet, 0);
  return (
    <button type="button" className={`bj-seat occupied ${isMine ? "mine" : ""} ${isSelected ? "selected" : ""} ${seat.hand?.status ?? ""}`} onClick={onSelect} aria-pressed={isSelected} aria-label={`${seat.seatNumber}번 좌석 ${seat.username}${isMine ? ", 내 좌석" : ", 따라 베팅 선택"}`}>
      <span className="bj-seat-number">{seat.seatNumber}</span>
      <span className="bj-seat-name">
        <strong>{isMine ? "MY HAND" : seat.username}</strong>
        {seat.winStreak >= 2 && <span className="bj-hot"><Flame size={10} /> {seat.winStreak}</span>}
      </span>
      {seat.hands.length > 1 && <span className="bj-hand-tabs">{seat.hands.map((hand) => <span key={hand.handId} className={hand.handId === seat.hand?.handId ? "active" : ""}>{hand.handIndex + 1}<b>{hand.cards.length ? handValue(hand.cards).total : "–"}</b></span>)}</span>}
      <span className={`bj-seat-cards ${cardCount === 3 ? "three-cards" : cardCount >= 4 ? "many-cards" : ""}`} data-card-count={cardCount}>
        {seat.hand?.cards.length ? (
          <>
            {seat.hand.cards.map((card, index) => <PlayingCard key={`${seat.seatNumber}-${index}`} card={card} animate={isMine || isSelected} />)}
            <span className="bj-seat-total">{total}</span>
          </>
        ) : (
          <span className="bj-waiting-hand">베팅 대기</span>
        )}
      </span>
      <span className="bj-seat-footer">
        {seat.hand && <span className={`bj-chip-stack chip-tier-${chipTier(seat.hand.bet)}`} aria-label={`본 베팅 ${totalBet}코인`}><i /><strong>{totalBet}</strong></span>}
        {seat.hand?.outcome && <span className={`bj-outcome ${seat.hand.outcome}`}>{OUTCOME_LABEL[seat.hand.outcome]}</span>}
        {seat.behindBetCount > 0 && <span className="bj-followers"><Users size={10} /> {seat.behindBetCount} · {seat.behindBetTotal}C</span>}
        {seat.myBehindBet > 0 && <span className="bj-my-follow">+{seat.myBehindBet}C</span>}
      </span>
    </button>
  );
}

function netForOutcome(outcome: BlackjackOutcome, amount: number): number {
  if (outcome === "win") return amount;
  if (outcome === "blackjack") return Math.round(amount * 1.5);
  if (outcome === "lose") return -amount;
  if (outcome === "surrender") return -(amount - Math.floor(amount / 2));
  return 0;
}

function cardPoint(card: BlackjackPlayerHand["cards"][number]): number {
  if (card.rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function phaseGuide(snapshot: BlackjackRoomSnapshot, selected: BlackjackSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다.";
  if (snapshot.room.phase === "BETTING") {
    if (!snapshot.mySeat && !selected?.userId) return "빈 좌석에 앉거나 플레이어를 선택해 따라 베팅하세요.";
    return "칩을 선택한 뒤 본 베팅 또는 따라 베팅을 완료하세요.";
  }
  if (snapshot.room.phase === "LOCKED") return "베팅을 마감했습니다.";
  if (snapshot.room.phase === "DEALING") return "좌석 순서대로 카드를 배분합니다.";
  if (snapshot.room.phase === "INSURANCE") return snapshot.myInsurance ? "보험 가입이 완료되었습니다." : "딜러의 오픈 카드가 A입니다. 보험 가입 여부를 선택하세요.";
  if (snapshot.room.phase === "PLAYER_TURN") return snapshot.myHand?.status === "playing" ? "내 패의 액션을 선택하세요." : "다른 좌석의 선택을 기다리고 있습니다.";
  if (snapshot.room.phase === "DEALER_TURN") return "딜러가 히든 카드를 공개하고 있습니다.";
  if (snapshot.room.phase === "SETTLING") return "모든 베팅을 정산하고 있습니다.";
  if (snapshot.room.phase === "RESULT") return "최종 패와 손익을 확인하세요.";
  return "좌석을 선택하면 다음 라운드가 시작됩니다.";
}

function blackjackPhaseLabel(phase: BlackjackRoomSnapshot["room"]["phase"]): string {
  return ({ WAITING: "플레이어 대기", BETTING: "베팅 중", LOCKED: "베팅 마감", DEALING: "카드 배분 중", INSURANCE: "보험 선택", PLAYER_TURN: "플레이어 턴", DEALER_TURN: "딜러 턴", SETTLING: "정산 중", RESULT: "라운드 결과" } as const)[phase];
}
