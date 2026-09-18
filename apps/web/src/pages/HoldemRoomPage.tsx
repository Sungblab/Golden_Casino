import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { CardBackFace } from "../components/CardFace";
import { ChipStack } from "../components/ChipStack";
import { DeckShoe } from "../components/DeckShoe";
import { GameShell, openGameGuide } from "../components/GameShell";
import { HoldemHandPanel } from "../components/HoldemHandPanel";
import { PlayingCard } from "../components/PlayingCard";
import { ActionButton, StepBar } from "../components/PvpBits";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { HoldemHandHistory } from "../components/HoldemHandHistory";
import { ActionBubble, CardSqueeze, pickLine } from "../components/TableBits";
import { holdemGuide } from "../lib/guides/holdem";
import { playSound } from "../lib/sound";
import { cardKey, readHoldemHand, HOLDEM_HAND_LABEL } from "../lib/holdemHandRead";
import { randomRequestId } from "../lib/requestId";

const ACTION_SECONDS = 20;
const TIMER_RING = 163.4;
// Seat layout around the oval, clockwise from the bottom (viewer's own seat is re-centered there).
// Each seat gets its unit-circle position as --sx/--sy; table-pvp.css picks the radii per layout.
const SEAT_ANGLES = [90, 150, 210, 270, 330, 30];
/** 1 = 타원, 작을수록 좌석이 모서리 쪽으로 밀린다. 0.62 는 6석이 서로 겹치지 않으면서
 *  네 귀퉁이를 쓰는 값(더 낮추면 위·아래 가운데 좌석이 옆 좌석과 붙는다). */
const SEAT_CORNER_PULL = 0.62;
/** 판 위에 뜨는 대사. 홀덤 테이블의 말투로(섯다판과 다르다). */
const HOLDEM_LINES: Record<string, string[]> = {
  fold: ["폴드", "접을게", "이번엔 빠진다", "안 맞네"],
  check: ["체크", "넘어가지", "일단 보자", "……"],
  call: ["콜", "받는다", "가보자", "따라간다"],
  bet: ["벳", "가볼까", "얼마나 받나 보자"],
  raise: ["레이즈", "올린다", "이 정도는 받아야지", "더 가자"],
  allin: ["올인!", "다 건다", "여기서 끝내자", "가진 거 전부"],
};
const STREET_STEPS = ["프리플랍", "플랍", "턴", "리버", "쇼다운"];
const STREET_STEPS_SHORT = ["프리", "플랍", "턴", "리버", "쇼다운"];

export function HoldemRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<HoldemRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [raiseTo, setRaiseTo] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const noticeRoundRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const prevActingSeatRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<HoldemRoomSnapshot["room"]["phase"] | null>(null);
  const [squeezed, setSqueezed] = useState(false);
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

  // 새 핸드가 시작되면 홀카드는 다시 엎어진 채로 온다.
  useEffect(() => { setSqueezed(false); }, [snapshot?.roundId]);

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

  // A rejected-action line ("지금은 액션을 …") must not sit on screen into the next street.
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.room.phase !== prevPhaseRef.current) {
      if (snapshot.room.phase === "PLAYER_TURN" || snapshot.room.phase === "WAITING") setMessage("");
      prevPhaseRef.current = snapshot.room.phase;
    }
  }, [snapshot]);

  // My own result banner. A win uses the winner's credited amount (reliable); a lost showdown
  // names the hand that beat mine, so the loss teaches something instead of just stinging.
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.lastWinners.length === 0 || noticeRoundRef.current === snapshot.roundId) return;
    noticeRoundRef.current = snapshot.roundId;
    const me = snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber);
    const mine = snapshot.lastWinners.find((winner) => winner.seatNumber === snapshot.mySeatNumber);
    if (mine) {
      // Rake comes out of the pot before a tie splits it, so a tied winner's share can land at
      // or below their own contribution — that's a split pot, not a loss, and must not read as
      // one. net:0 keeps the notice's tone neutral (push) while `amount` still shows the true,
      // possibly-negative number the rake left them with.
      const tied = mine.amount <= 0;
      setResultNotice({
        net: tied ? 0 : mine.amount,
        amount: mine.amount,
        title: tied
          ? (mine.handCategory ? `${HOLDEM_HAND_LABEL[mine.handCategory]} 무승부 · 팟 분할` : "무승부 · 팟 분할")
          : (mine.handCategory ? `${HOLDEM_HAND_LABEL[mine.handCategory]}로 승리` : "승리했습니다"),
      });
      playSound(tied ? "tie" : "win");
    } else if (me && me.dealtIn && !me.folded && me.totalContributed > 0) {
      const winner = snapshot.lastWinners[0]!;
      setResultNotice({
        net: -me.totalContributed,
        amount: -me.totalContributed,
        title: winner.handCategory ? `${winner.username}님의 ${HOLDEM_HAND_LABEL[winner.handCategory]}에 패배` : `${winner.username}님이 팟 획득`,
      });
      playSound("lose");
    } else return;
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), 4_200);
  }, [snapshot]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  // Hold'em waits between turns can run long with five other players acting — a cue the
  // instant it becomes my turn again matters more here than in the single-actor games.
  useEffect(() => {
    if (!snapshot) return;
    const isMyTurnNow = snapshot.mySeatNumber !== null && snapshot.actingSeat === snapshot.mySeatNumber;
    if (isMyTurnNow && prevActingSeatRef.current !== snapshot.actingSeat) playSound("turn");
    prevActingSeatRef.current = snapshot.actingSeat;
  }, [snapshot?.actingSeat, snapshot?.mySeatNumber]);

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "테이블에 연결하고 있습니다…"}</p></div>;

  const mySeat = snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber) ?? null;
  const myTurn = snapshot.mySeatNumber !== null && snapshot.actingSeat === snapshot.mySeatNumber;
  // Live, client-only read of my own hand — safe because it only ever combines my own hole
  // cards (already visible to me) with the public board, never another player's cards. Lets
  // a beginner see "지금 뭐 만들었는지" without opening the 족보 reference or waiting for the
  // server's showdown reveal. Drives both the rail's hand panel and the gold ring on the
  // cards that actually make the hand.
  // 아직 쪼지 않았으면 내 패를 읽어 주지 않는다 — 레일 패널이 먼저 "Q 하이"라고 말해 버리면
  // 카드를 엎어 둔 의미가 없다. (쇼다운에는 어차피 다 열려 있다.)
  const handHidden = !squeezed && snapshot.street !== "showdown" && (mySeat?.holeCards?.length ?? 0) > 0;
  const myHandRead = mySeat?.folded || handHidden ? null : readHoldemHand(mySeat?.holeCards ?? null, snapshot.board);
  const potTotal = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0);
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / ACTION_SECONDS));
  const winnerBySeat = new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner]));
  const inHand = Boolean(mySeat && mySeat.dealtIn && !mySeat.folded);
  const closing = myTurn && seconds <= 5;

  const sit = (seatNumber: number) => {
    socket.emit("holdem.sit", { requestId: randomRequestId(), roomId, seatNumber }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };
  const standUp = () => {
    // Leaving with live cards folds them on the server — say so before it happens.
    if (inHand && snapshot.roundId && (mySeat?.totalContributed ?? 0) > 0 && !window.confirm("진행 중인 핸드를 포기(폴드)하고 자리를 비웁니다. 지금까지 낸 베팅은 돌려받지 못해요. 계속할까요?")) return;
    socket.emit("holdem.standUp", { roomId }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };
  const setReady = (readyValue: boolean) => {
    socket.emit("holdem.ready", { roomId, ready: readyValue }, (ack) => {
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(ack.error);
    });
  };
  const act = (action: HoldemAction, amount?: number) => {
    if (!snapshot.roundId) return;
    socket.emit("holdem.act", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, action, amount }, (ack) => {
      if (ack.ok) {
        setSnapshot(ack.data);
        playSound(action === "fold" ? "fold" : action === "allin" ? "allin" : "chip");
      } else {
        setMessage(ack.error);
      }
    });
  };

  const bigBlind = snapshot.room.minBet * 2;
  const maxRaiseTo = (mySeat?.stack ?? 0) + (mySeat?.streetContributed ?? 0);
  const minRaiseClamped = Math.min(snapshot.minRaiseTo, maxRaiseTo);
  const clampRaise = (value: number): number => Math.max(minRaiseClamped, Math.min(maxRaiseTo, value));
  // 프리셋 금액. 예전엔 raise-to 를 그냥 '팟의 N분의 1'로 잡았는데, 그건 팟 레이즈가 아니다:
  // 표준은 "콜을 받은 뒤의 팟"을 기준으로 그 비율만큼 더 올리는 것이라 raise-to 는
  //   지금 기준 금액 + 콜 + 비율 × (팟 + 콜)
  // 이 된다. 옛 식은 작은 팟에서 쿼터·하프·팟이 전부 최소 레이즈로 뭉개져 버튼 네 개가
  // 같은 숫자를 보여 줬다. 프리플랍에서 아직 아무도 안 올렸으면 포커 관례대로 BB 배수를 쓴다.
  const myStreet = mySeat?.streetContributed ?? 0;
  const standingBet = myStreet + snapshot.toCall;
  const potAfterCall = potTotal + snapshot.toCall;
  const potRaise = (fraction: number) => clampRaise(standingBet + Math.round(fraction * potAfterCall));
  const openingPreflop = snapshot.street === "preflop" && standingBet <= bigBlind;
  const raisePresets = openingPreflop
    ? [
        { key: "open2h", label: "2.5x", hint: "BB 2.5배", value: clampRaise(Math.round(bigBlind * 2.5)) },
        { key: "open3", label: "3x", hint: "BB 3배", value: clampRaise(bigBlind * 3) },
        { key: "open4", label: "4x", hint: "BB 4배", value: clampRaise(bigBlind * 4) },
        { key: "max", label: "맥스", hint: "올인", value: maxRaiseTo },
      ]
    : [
        { key: "min", label: "MIN", hint: "최소", value: minRaiseClamped },
        { key: "third", label: "1/3", hint: "팟 ⅓", value: potRaise(1 / 3) },
        { key: "half", label: "하프", hint: "팟 ½", value: potRaise(0.5) },
        { key: "pot", label: "팟", hint: "팟 크기", value: potRaise(1) },
        { key: "max", label: "맥스", hint: "올인", value: maxRaiseTo },
      ];
  const canRaise = maxRaiseTo > snapshot.toCall + (mySeat?.streetContributed ?? 0);
  const raiseValue = Math.min(raiseTo, maxRaiseTo);
  const callAmount = Math.min(snapshot.toCall, mySeat?.stack ?? 0);
  const callIsAllIn = snapshot.toCall > 0 && callAmount < snapshot.toCall;
  const readyCount = snapshot.seats.filter((seat) => seat.userId && seat.ready).length;
  const seatedCount = snapshot.seats.filter((seat) => seat.userId).length;
  const step = streetStep(snapshot);
  // 기본 시간이 끝나고 타임뱅크로 버티는 중인지. 링과 턴 스트립의 색이 바뀐다.
  const onTimeBank = snapshot.timeBankSeat !== null && snapshot.timeBankSeat === snapshot.mySeatNumber;
  const myTimeBankSeconds = Math.round((mySeat?.timeBankMs ?? 0) / 1000);

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`블라인드 ${snapshot.room.minBet}/${bigBlind} · 최대 ${snapshot.room.maxBet} · 6-MAX`}
      phaseLabel={snapshot.room.paused
        ? "일시정지"
        // WAITING *with* a deadline is the between-hands break the server holds open so a player
        // can stand up; without one it's the ordinary "nobody is ready yet" idle.
        : snapshot.room.phase === "WAITING" && snapshot.phaseEndsAt
          ? "다음 핸드까지"
          : phaseLabel(snapshot.room.phase, snapshot.street)}
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
      guide={holdemGuide}
    >
      {/* Table on the left, action rail on the right; on a portrait phone the rail becomes a
          bottom dock under the (now upright) table — see table-pvp.css. The actions never
          overlay the felt in either layout. */}
      <div className="room-shell holdem-room-shell">
        <section className="ot-stage">
          <div className="ot-felt holdem-felt">
            <div className="ot-feed"><WinnerFeed socket={socket} /></div>
            <RoundResultNotice notice={resultNotice} />
            <div className="holdem-table">
              <DeckShoe />
              <div className="holdem-table-rail" aria-hidden="true" />
              <div className="holdem-action-line" aria-hidden="true" />
              <div className="holdem-table-brand" aria-hidden="true">TEXAS HOLD&apos;EM</div>
              <div className="holdem-board">
                <div className="holdem-pot">
                  {potTotal > 0 && <span>POT {potTotal.toLocaleString()}</span>}
                  {snapshot.pots.length > 1 && (
                    <small className="holdem-pot-split">메인 {snapshot.pots[0]!.amount.toLocaleString()} · 사이드 {snapshot.pots.slice(1).map((pot) => pot.amount.toLocaleString()).join(" / ")}</small>
                  )}
                </div>
                <div className="holdem-board-cards">
                  {snapshot.board.map((card, index) => (
                    <PlayingCard
                      key={index}
                      card={card}
                      delayMs={index * 120}
                      highlighted={myHandRead?.usedKeys.has(cardKey(card)) ?? false}
                    />
                  ))}
                  {Array.from({ length: 5 - snapshot.board.length }).map((_, index) => <span key={`slot-${index}`} className="ot-card-slot holdem-board-slot" />)}
                </div>
                {snapshot.lastWinners.length > 0 && (
                  <div className="holdem-winners">
                    {snapshot.lastWinners.map((winner) => (
                      <span key={winner.seatNumber} className="holdem-winner-pill">
                        {winner.username} +{winner.amount.toLocaleString()}{winner.handCategory ? ` (${HOLDEM_HAND_LABEL[winner.handCategory]})` : " (상대 전원 폴드)"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {orderedSeats(snapshot.seats, snapshot.mySeatNumber).map(({ seat, angle }) => (
                <SeatView
                  key={seat.seatNumber}
                  seat={seat}
                  angle={angle}
                  onSit={() => sit(seat.seatNumber)}
                  canSit={!mySeat && !seat.userId}
                  isMine={seat.seatNumber === snapshot.mySeatNumber}
                  highlightKeys={seat.seatNumber === snapshot.mySeatNumber ? myHandRead?.usedKeys : undefined}
                  showReady={snapshot.room.phase === "WAITING"}
                  squeezed={squeezed}
                  onSqueeze={() => setSqueezed(true)}
                  myTurn={myTurn}
                  showdown={snapshot.street === "showdown"}
                  winnerLabel={winnerBySeat.get(seat.seatNumber) ? `WIN +${winnerBySeat.get(seat.seatNumber)!.amount.toLocaleString()}` : null}
                />
              ))}
              {myTurn && (
                <div className={`ot-timer holdem-timer ${closing ? "closing" : ""} ${onTimeBank ? "is-timebank" : ""}`}>
                  <svg viewBox="0 0 60 60"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} /></svg>
                  <span className="ot-timer-num">{seconds}</span>
                  {onTimeBank && <span className="holdem-timebank-tag">타임뱅크</span>}
                </div>
              )}
            </div>
            {!mySeat && (
              <div className="felt-prompt">
                빈 자리를 눌러 앉으세요
                <small>앉으려면 최소 {bigBlind.toLocaleString()}코인 필요 · 관전은 자유</small>
              </div>
            )}
            {message && <p className="ot-message">{message}</p>}
          </div>

          {/* The action rail — the right-hand column on desktop and landscape phones, the
              bottom dock in portrait. Always a sibling of the felt, never an overlay on it. */}
          <aside className="holdem-rail-v4" aria-label="홀덤 액션">
            <StepBar steps={STREET_STEPS} shortSteps={STREET_STEPS_SHORT} current={step} ariaLabel="이번 핸드 진행 단계" />

            {handHidden && (
              <div className="holdem-hand-panel is-hint">
                <header>
                  <span className="holdem-hand-panel-eyebrow">내 패</span>
                  <span className="holdem-hand-panel-private">나만 보여요</span>
                </header>
                <div className="holdem-hand-panel-body">
                  <div className="holdem-hand-panel-text">
                    <strong>아직 안 봤어요</strong>
                    <span>테이블의 내 카드를 눌러 확인하세요</span>
                  </div>
                </div>
              </div>
            )}
            {myHandRead && mySeat?.holeCards && (
              <HoldemHandPanel read={myHandRead} holeCards={mySeat.holeCards} />
            )}

            <div className="holdem-rail-meta">
              {mySeat && myTimeBankSeconds > 0 && <span>여유 <b className={onTimeBank ? "gold" : ""}>{myTimeBankSeconds}초</b></span>}
              <span>POT <b>{potTotal.toLocaleString()}</b></span>
              {mySeat && inHand && <span>내 베팅 <b>{mySeat.totalContributed.toLocaleString()}</b></span>}
              {myTurn && snapshot.toCall > 0 && <span>콜 <b className="gold">{callAmount.toLocaleString()}</b></span>}
            </div>

            {mySeat && myTurn && (
              <>
                <div className={`turn-strip ${closing ? "is-closing" : ""} ${onTimeBank ? "is-timebank" : ""}`} role="status" aria-live="polite">
                  <div>
                    <strong>{onTimeBank ? "타임뱅크 사용 중" : "내 차례예요"}</strong>
                    <small>
                      {onTimeBank
                        ? "기본 시간이 끝나 여유 시간을 쓰고 있어요. 다 쓰면 자동으로 처리돼요."
                        : snapshot.toCall > 0 ? `콜 ${callAmount.toLocaleString()} 또는 폴드 · 레이즈 가능` : "체크로 넘기거나 베팅 가능"}
                    </small>
                  </div>
                  <b>{seconds}</b>
                  <span className="turn-strip-bar" style={{ width: `${Math.min(100, (seconds / ACTION_SECONDS) * 100)}%` }} aria-hidden="true" />
                </div>
                {canRaise && (
                  <>
                    {/* One tap bets/raises at that sizing — the 한게임/피망 bar behavior these
                        labels come from; a select-then-confirm preset made the same move cost
                        two taps and read as broken to players used to those rooms. The stepper
                        below stays the two-step path for custom amounts. */}
                    <div className="holdem-presets" aria-label="레이즈 금액 바로 선택">
                      {raisePresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.key}
                          className="holdem-preset"
                          title={`${preset.hint} · ${preset.value.toLocaleString()}까지 ${snapshot.toCall === 0 ? "베팅" : "레이즈"}`}
                          onClick={() => (preset.key === "max" ? act("allin") : act(snapshot.toCall === 0 ? "bet" : "raise", preset.value))}
                        >
                          <span>{preset.label}</span>
                          <b>{preset.value.toLocaleString()}</b>
                        </button>
                      ))}
                    </div>
                    <div className="holdem-stepper">
                      <button type="button" className="holdem-step-btn" disabled={raiseTo <= minRaiseClamped} onClick={() => setRaiseTo((value) => clampRaise(value - bigBlind))} aria-label="레이즈 금액 줄이기">−</button>
                      <div className="holdem-step-value"><small>RAISE TO</small><strong>{raiseValue.toLocaleString()}</strong></div>
                      <button type="button" className="holdem-step-btn" disabled={raiseTo >= maxRaiseTo} onClick={() => setRaiseTo((value) => clampRaise(value + bigBlind))} aria-label="레이즈 금액 늘리기">＋</button>
                    </div>
                  </>
                )}
                <div className="holdem-act-row">
                  <ActionButton label="폴드" hint="포기하기" tone="red" onClick={() => act("fold")} />
                  {snapshot.toCall === 0
                    ? <ActionButton label="체크" hint="그냥 넘기기" tone="gold" onClick={() => act("check")} />
                    : <ActionButton label={`콜 ${callAmount.toLocaleString()}`} hint={callIsAllIn ? "잔액 전부 · 올인" : "따라가기"} tone="blue" onClick={() => act("call")} />}
                  {canRaise && (
                    <ActionButton
                      label={`${snapshot.toCall === 0 ? "베팅" : "레이즈"} ${raiseValue.toLocaleString()}`}
                      hint={snapshot.toCall === 0 ? "돈 걸기" : "더 올리기"}
                      tone="green"
                      onClick={() => act(snapshot.toCall === 0 ? "bet" : "raise", raiseValue)}
                    />
                  )}
                  {maxRaiseTo > 0 && <ActionButton label={`올인 ${maxRaiseTo.toLocaleString()}`} hint="전부 걸기" tone="purple" onClick={() => act("allin")} />}
                </div>
              </>
            )}

            {!myTurn && snapshot.room.phase !== "WAITING" && (
              <>
                <p className="holdem-rail-status">{railStatus(snapshot, mySeat)}</p>
                {mySeat && mySeat.folded && <p className="rail-hint">이번 핸드는 폴드했어요. 핸드가 끝나면 다음 핸드에 자동으로 참여합니다.</p>}
                {mySeat && mySeat.allIn && !mySeat.folded && <p className="rail-hint">올인 상태예요. 남은 카드가 자동으로 열리고 쇼다운으로 갑니다.</p>}
                {mySeat && !mySeat.dealtIn && snapshot.roundId && <p className="rail-hint">진행 중인 핸드가 끝나면 다음 핸드부터 참여해요.</p>}
              </>
            )}

            {mySeat && !myTurn && snapshot.room.phase === "WAITING" && (
              <div className="holdem-ready-dock">
                <span className="holdem-ready-status">{readyCount}/{seatedCount}명 준비 완료</span>
                <button
                  type="button"
                  className={`outline-button ${mySeat.ready ? "bj-act-surrender" : "bj-act-hit"}`}
                  onClick={() => setReady(!mySeat.ready)}
                >
                  {mySeat.ready ? "준비 취소" : "준비 완료"}
                </button>
                <p className="rail-hint">
                  {seatedCount < 2 ? <>상대가 한 명 더 앉으면 시작할 수 있어요</> : <>앉은 사람 <b>모두</b> 준비되면 자동 시작 · 블라인드 {snapshot.room.minBet}/{bigBlind}</>}
                </p>
              </div>
            )}

            {!mySeat && (
              <p className="rail-hint">테이블의 빈 자리를 누르면 참여할 수 있어요. 처음이라면 위의 <b>도움말</b>에서 족보표와 게임 방법을 확인하세요.</p>
            )}

            {/* Fills the gap between the actions and the footer controls on desktop; hidden in
                the bottom-dock layout. */}
            <HoldemHandHistory hands={snapshot.recentHands} />

            <div className="holdem-rail-spacer" />

            <div className="holdem-rail-footer">
              <button type="button" className="outline-button" onClick={() => openGameGuide("rankings")}>족보표</button>
              {mySeat && (
                <button
                  type="button"
                  className="outline-button holdem-rail-secondary"
                  onClick={standUp}
                  title={inHand && (mySeat.totalContributed > 0) ? "진행 중인 핸드를 포기하고 나갑니다" : undefined}
                >
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

function orderedSeats(seats: HoldemSeatSnapshot[], mySeatNumber: number | null): Array<{ seat: HoldemSeatSnapshot; angle: number }> {
  const rotation = mySeatNumber ? mySeatNumber - 1 : 0;
  return seats.map((seat, index) => ({ seat, angle: SEAT_ANGLES[(index - rotation + seats.length) % seats.length]! }));
}

function SeatView({ seat, angle, onSit, canSit, isMine, highlightKeys, showReady, winnerLabel, squeezed, onSqueeze, myTurn, showdown }: { seat: HoldemSeatSnapshot; angle: number; onSit: () => void; canSit: boolean; isMine: boolean; highlightKeys?: Set<string>; showReady: boolean; winnerLabel: string | null; squeezed: boolean; onSqueeze: () => void; myTurn: boolean; showdown: boolean }) {
  // Unit-circle position only; the x/y radii are CSS variables (table-pvp.css) so the
  // landscape racetrack (45%/33%, tuned against the action-line ellipse — see
  // table-holdem.css) and the upright portrait oval can differ without touching this code.
  // 좌석을 타원이 아니라 '모서리가 둥근 사각형'의 둘레에 앉힌다. 지수를 1보다 작게 주면
  // (초타원) 같은 각도라도 점이 바깥으로 밀려 네 귀퉁이 쪽을 쓰게 된다 — 테이블이 사각형이
  // 된 이상 좌석만 타원에 남으면 그만큼이 다시 빈다. 1이면 예전 타원 그대로.
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const squircle = (value: number) => (Math.sign(value) * Math.pow(Math.abs(value), SEAT_CORNER_PULL)).toFixed(4);
  const style = { "--sx": squircle(cos), "--sy": squircle(sin) } as CSSProperties;
  if (!seat.userId) {
    return canSit ? (
      <button className="holdem-seat holdem-seat-empty" style={style} onClick={onSit} aria-label={`${seat.seatNumber}번 좌석 앉기`}>
        <span>앉기</span>
      </button>
    ) : <div className="holdem-seat holdem-seat-empty" style={style} />;
  }
  return (
    <div className={`holdem-seat ${isMine ? "is-mine" : ""} ${seat.isTurn ? "is-turn" : ""} ${seat.folded ? "is-folded" : ""} ${seat.sittingOut ? "is-away" : ""} ${winnerLabel ? "is-winner" : ""}`} style={style}>
      <div className="holdem-seat-cards">
        {/* Three distinct states: my own (or a revealed showdown) hand shows faces; an
            opponent who was dealt in but is still hidden shows card BACKS; and only a
            genuinely undealt seat shows the empty slot. */}
        {seat.holeCards
          ? seat.holeCards.map((card, index) => {
            const face = (
              <PlayingCard
                card={card}
                animate={false}
                highlighted={highlightKeys?.has(cardKey(card)) ?? false}
              />
            );
            if (!isMine || squeezed || showdown) return <span key={index}>{face}</span>;
            // 두 장 다 엎어 두되 힌트는 한 번만 — 어느 쪽을 눌러도 손패가 함께 열린다.
            return (
              <CardSqueeze key={index} openNow={myTurn} onOpen={onSqueeze} hint={index === 1 ? "눌러서 쪼기" : ""}>
                {face}
              </CardSqueeze>
            );
          })
          : Array.from({ length: 2 }).map((_, index) => (
            seat.dealtIn
              ? <span key={index} className="playing-card holdem-hole-back"><span className="playing-card-inner"><span className="playing-card-back"><CardBackFace /></span></span></span>
              : <span key={index} className="ot-card-slot holdem-hole-slot" />
          ))}
      </div>
      {seat.lastAction && !showdown && (
        <ActionBubble
          text={pickLine(HOLDEM_LINES[seat.lastAction.action] ?? [seat.lastAction.action], seat.seatNumber, seat.lastAction.action, seat.lastAction.amount)}
          amount={seat.lastAction.action === "fold" || seat.lastAction.action === "check" ? undefined : seat.lastAction.amount}
          tone={seat.lastAction.action === "fold" ? "out" : seat.lastAction.action === "check" || seat.lastAction.action === "call" ? "calm" : "push"}
        />
      )}
      {/* Name + stack share one dark nameplate, the way every real client draws seats. The
          position badges (D / SB / BB) sit beside the name so a beginner can see who posts
          the blinds and where the action starts. */}
      <div className="holdem-seat-plate">
        <div className="holdem-seat-name">
          {(seat.isButton || seat.isSmallBlind || seat.isBigBlind) && (
            <span className="holdem-seat-badges">
              {seat.isButton && <span className="seat-badge is-button" title="딜러 버튼 · 매 핸드 시계 방향으로 이동">D</span>}
              {seat.isSmallBlind && <span className="seat-badge is-sb" title="스몰 블라인드 · 기본 베팅의 절반을 먼저 냄">SB</span>}
              {seat.isBigBlind && <span className="seat-badge is-bb" title="빅 블라인드 · 기본 베팅을 먼저 냄">BB</span>}
            </span>
          )}
          <span className="holdem-seat-nick" title={seat.username ?? undefined}>{isMine ? "나" : seat.username}</span>
          {showReady && <span className={`holdem-ready-dot ${seat.ready ? "is-ready" : ""}`} title={seat.ready ? "준비 완료" : "준비 대기"} />}
        </div>
        <div className="holdem-seat-stack">{seat.stack.toLocaleString()}</div>
      </div>
      <ChipStack amount={seat.streetContributed} label="베팅" />
      {seat.folded && <div className="holdem-seat-status fold">폴드</div>}
      {seat.allIn && !seat.folded && <div className="holdem-seat-status allin">올인</div>}
      {winnerLabel && <div className="holdem-seat-status win">{winnerLabel}</div>}
      {/* Showdown reveal — my own live read lives in the rail's hand panel instead. */}
      {!seat.folded && seat.handCategory && (
        <div className="holdem-seat-status hand">{HOLDEM_HAND_LABEL[seat.handCategory]}</div>
      )}
    </div>
  );
}

/** 0-based index into STREET_STEPS, or -1 between hands. */
function streetStep(snapshot: HoldemRoomSnapshot): number {
  if (snapshot.room.phase === "SETTLING" || snapshot.room.phase === "RESULT" || snapshot.street === "showdown") return 4;
  switch (snapshot.street) {
    case "preflop": return 0;
    case "flop": return 1;
    case "turn": return 2;
    case "river": return 3;
    default: return snapshot.roundId ? 0 : -1;
  }
}

/**
 * 을/를 by whether the word ends in a 받침 — "리버을 여는 중" is wrong, "리버를" is right,
 * and the street names split across both cases (플랍/턴 take 을, 리버 takes 를).
 */
function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

/** What the rail says while the viewer has nothing to act on. */
function railStatus(snapshot: HoldemRoomSnapshot, mySeat: HoldemSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  if (snapshot.room.phase === "DEALING") {
    if (snapshot.street === "preflop" || !snapshot.street) return "카드를 나눠주고 있어요";
    const street = STREET_LABEL[snapshot.street] ?? snapshot.street;
    return `${street}${objectParticle(street)} 여는 중이에요`;
  }
  if (snapshot.room.phase === "SETTLING" || snapshot.room.phase === "RESULT") return "카드를 공개하고 족보를 비교하고 있어요";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님이 선택하는 중… ${mySeat && !mySeat.folded && mySeat.dealtIn && !mySeat.allIn ? "곧 내 차례가 와요" : ""}`.trim();
  return "다른 자리의 선택을 기다리고 있어요";
}

function phaseLabel(phase: HoldemRoomSnapshot["room"]["phase"], street: HoldemRoomSnapshot["street"]): string {
  if (phase === "PLAYER_TURN") return `${STREET_LABEL[street ?? "preflop"] ?? "베팅"} 베팅`;
  if (phase === "DEALING") return street === "preflop" || !street ? "카드 딜링" : `${STREET_LABEL[street] ?? street} 오픈`;
  if (phase === "SETTLING") return "쇼다운";
  if (phase === "RESULT") return "핸드 종료";
  return "플레이어 대기";
}

const STREET_LABEL: Record<string, string> = { preflop: "프리플랍", flop: "플랍", turn: "턴", river: "리버", showdown: "쇼다운" };
