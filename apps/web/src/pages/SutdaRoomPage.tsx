import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, SutdaAction, SutdaRoomSnapshot, SutdaSeatSnapshot } from "@golden/contracts";
import { API_URL } from "../api";
import { Brand } from "../components/Brand";
import { ChipStack } from "../components/ChipStack";
import { GameShell, openGameGuide } from "../components/GameShell";
import { HwatuCard } from "../components/HwatuCard";
import { ActionButton, HandStrengthMeter, StepBar } from "../components/PvpBits";
import { RoomChat } from "../components/RoomChat";
import { ActionBubble, CardSqueeze, pickLine } from "../components/TableBits";
import { SutdaLadder, SutdaResultBoard } from "../components/SutdaPanels";
import { sutdaGuide } from "../lib/guides/sutda";
import { applyShoeFlight } from "../lib/shoeFlight";
import { playSound } from "../lib/sound";
import { randomRequestId } from "../lib/requestId";
import { readSutdaHand } from "../lib/sutdaHandRead";

const ACTION_SECONDS = 20;
/** 판 위에 뜨는 대사. 섯다판의 말투로. */
const SUTDA_LINES: Record<SutdaAction, string[]> = {
  die: ["죽었다", "에라, 못 먹겠네", "다음 판에 보자", "접는다"],
  check: ["체크", "그냥 가지", "일단 보자", "……"],
  call: ["콜", "받는다", "그래 보자", "따라가지"],
  bbing: ["삥!", "간 좀 보자", "슬슬 가볼까"],
  ddadang: ["따당!", "두 배다", "겁나?", "올려보자고"],
  quarter: ["쿼터", "조금 더", "이 정도는 받아야지"],
  half: ["하프!", "판돈 절반 간다", "이쯤에서 접든가", "세게 간다"],
  allin: ["올인!", "다 건다", "여기서 끝내자", "가진 거 전부"],
};
/** 용어 밑에 붙는 한 줄 설명 — 삥·따당·쿼터는 처음 보면 금액 규칙이 안 보인다. */
const ACTION_HINT: Record<SutdaAction, string> = {
  die: "포기하기", check: "그냥 넘기기", call: "따라가기",
  bbing: "기본 판돈만큼", ddadang: "앞사람 2배", quarter: "판돈 ¼", half: "판돈 ½", allin: "가진 전부",
};
const ACTION_TONE: Record<SutdaAction, "red" | "gold" | "blue" | "green" | "purple"> = {
  die: "red", check: "gold", call: "blue",
  bbing: "green", ddadang: "green", quarter: "green", half: "green", allin: "purple",
};
const TIMER_RING = 163.4;
// Same table geometry as Hold'em (see its SeatView): the unit-circle position goes into
// --sx/--sy and table-pvp.css picks the radii per layout (landscape vs portrait).
const SEAT_ANGLES = [90, 150, 210, 270, 330, 30];
const ROUND_STEPS = ["첫 패", "1차 베팅", "둘째 패", "2차 베팅", "승부"];
const ROUND_STEPS_SHORT = ["첫패", "1차", "둘째", "2차", "승부"];

export function SutdaRoomPage({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { roomId = "" } = useParams();
  const [snapshot, setSnapshot] = useState<SutdaRoomSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [squeezed, setSqueezed] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const noticeKeyRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<SutdaRoomSnapshot["room"]["phase"] | null>(null);
  const prevTurnRef = useRef(false);
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(() => io(API_URL, { auth: { token }, autoConnect: false }), [token]);

  useEffect(() => {
    const accept = (next: SutdaRoomSnapshot) => setSnapshot((current) => !current || next.sequence >= current.sequence ? next : current);
    const connect = () => socket.emit("sutda.join", { roomId }, (ack) => ack.ok ? accept(ack.data) : setMessage(ack.error));
    const wallet = ({ balance }: { balance: number }) => setSnapshot((current) => current ? { ...current, walletBalance: balance } : current);
    const onConnectError = (error: Error) => error.message === "UNAUTHORIZED"
      ? window.dispatchEvent(new Event("golden:session-expired"))
      : setMessage("게임 서버에 연결할 수 없습니다.");
    socket.on("connect", connect);
    socket.on("sutda.snapshot", accept);
    socket.on("wallet.updated", wallet);
    socket.on("connect_error", onConnectError);
    socket.connect();
    return () => { socket.emit("sutda.leave", { roomId }, () => undefined); socket.disconnect(); socket.off(); };
  }, [roomId, socket]);

  useEffect(() => {
    const update = () => setSeconds(snapshot?.phaseEndsAt ? Math.max(0, Math.ceil((Date.parse(snapshot.phaseEndsAt) - Date.now()) / 1000)) : 0);
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [snapshot?.phaseEndsAt]);

  // 새 판이 시작되면 둘째 장은 다시 엎어진 채로 온다.
  useEffect(() => { setSqueezed(false); }, [snapshot?.roundId]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  // Table cues, once per transition. Only the turn call: the shared sound set is a baccarat
  // ANNOUNCER (deal = "베팅이 마감됐습니다", chip = "베팅을 시작하겠습니다"), written for a table
  // where a betting window opens and closes on a timer. 섯다 has no such window — the dealer
  // deals and each player acts on their turn — so those lines were narrating a game that isn't
  // being played. Dropped rather than replaced: silence beats a wrong announcement until this
  // table gets its own effects (패 던지는 소리 / 돈 놓는 소리).
  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.room.phase !== prevPhaseRef.current) {
      // A stale "NOT_YOUR_TURN"/rejected-action line must not sit on screen into the next street.
      if (snapshot.room.phase === "PLAYER_TURN" || snapshot.room.phase === "WAITING") setMessage("");
      prevPhaseRef.current = snapshot.room.phase;
    }
    const myTurnNow = snapshot.mySeatNumber !== null && snapshot.actingSeat === snapshot.mySeatNumber;
    if (myTurnNow && !prevTurnRef.current) playSound("turn");
    prevTurnRef.current = myTurnNow;
  }, [snapshot]);

  // 판이 끝났을 때의 소리만 남긴다 — 무엇으로 이겼고 누가 얼마를 가져갔는지는 판 한가운데의
  // 외침과 레일의 게임결과 표가 말한다(예전엔 여기에 개인 배너가 하나 더 떠서 서로를 가렸다).
  useEffect(() => {
    if (!snapshot || snapshot.lastWinners.length === 0 || snapshot.mySeatNumber === null) return;
    const key = snapshot.lastWinners.map((w) => `${w.seatNumber}:${w.amount}`).join("|");
    if (noticeKeyRef.current === key) return;
    noticeKeyRef.current = key;
    const me = snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber);
    const mine = snapshot.lastWinners.find((w) => w.seatNumber === snapshot.mySeatNumber);
    if (mine) playSound("win");
    else if (me && me.cardCount > 0 && !me.folded) playSound(snapshot.lastWinners[0]!.handLabel.includes("재경기") ? "tie" : "lose");
  }, [snapshot]);

  if (!snapshot) return <div className="loading-screen"><Brand /><p>{message || "섯다방에 연결하고 있습니다…"}</p></div>;

  const mine = snapshot.seats.find((seat) => seat.seatNumber === snapshot.mySeatNumber) ?? null;
  const myTurn = snapshot.actingSeat === snapshot.mySeatNumber && snapshot.mySeatNumber !== null;
  const seated = snapshot.seats.filter((seat) => seat.userId).length;
  const readyCount = snapshot.seats.filter((seat) => seat.userId && seat.ready).length;
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / ACTION_SECONDS));
  const winnerBySeat = new Map(snapshot.lastWinners.map((winner) => [winner.seatNumber, winner]));
  // 버튼 금액은 서버가 내려준 것을 그대로 쓴다. v1 은 클라이언트가 하프 금액을 따로 계산해서
  // 서버 사이징이 바뀌면 조용히 어긋날 수 있었다 — 이제 game-core 의 sutdaBetOptions 한 곳에서 나온다.
  const toCall = snapshot.toCall;
  const betOptions = snapshot.betOptions;
  const myRead = mine && !mine.folded ? readSutdaHand(mine.cards) : null;
  const inHand = Boolean(mine && mine.cardCount > 0 && !mine.folded);
  const step = roundStep(snapshot);
  const closing = myTurn && seconds <= 5;
  // 판돈은 숫자만이 아니라 장판 위에 실제로 쌓인다 — 삥 한 장 단위로 지폐를 얹고 14장에서 멈춘다.
  const cashBills = snapshot.pot.amount > 0
    ? Math.max(1, Math.min(14, Math.round(snapshot.pot.amount / Math.max(1, snapshot.room.minBet))))
    : 0;

  const command = (action: SutdaAction) => {
    if (!snapshot.roundId) return;
    socket.emit("sutda.act", { requestId: randomRequestId(), roomId, roundId: snapshot.roundId, action }, (ack) => {
      // No cue on a successful action for the same reason as above — "chip" announces
      // "베팅을 시작하겠습니다" and "fold" says the English word "Fold", neither of which
      // belongs on a 섯다 판.
      if (ack.ok) setSnapshot(ack.data);
      else setMessage(errorText(ack.error));
    });
  };
  const sit = (seatNumber: number) => socket.emit("sutda.sit", { requestId: randomRequestId(), roomId, seatNumber }, (ack) => ack.ok ? setSnapshot(ack.data) : setMessage(errorText(ack.error)));
  const ready = () => socket.emit("sutda.ready", { roomId, ready: !mine?.ready }, (ack) => ack.ok ? setSnapshot(ack.data) : setMessage(errorText(ack.error)));
  const stand = () => {
    // Leaving with live cards folds them on the server — say so before it happens.
    if (inHand && snapshot.roundId && !window.confirm("진행 중인 판을 포기(다이)하고 자리를 비웁니다. 지금까지 낸 베팅은 돌려받지 못해요. 계속할까요?")) return;
    socket.emit("sutda.standUp", { roomId }, (ack) => ack.ok ? setSnapshot(ack.data) : setMessage(errorText(ack.error)));
  };

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
      guide={sutdaGuide}
    >
      {/* Two-column shell from Hold'em v4 (stage left, action rail right; a portrait phone
          turns the rail into a bottom dock — table-pvp.css). The SHELL is shared; the play
          surface is not: 섯다 draws a floor mat, not a table. See table-sutda.css. */}
      <div className="room-shell holdem-room-shell sutda-shell">
        <section className="ot-stage">
          <div className="ot-felt holdem-felt sutda-felt">
            <div className="holdem-table sutda-mat">
              {/* 섯다는 테이블에서 하는 게임이 아니다 — 방바닥에 편 장판 위에서 한다. 그래서
                  가죽 레일도, 인쇄된 베팅 라인도, 타원 테두리도 없다. 장판이 곧 화면이고
                  (사각형이라 구석까지 다 쓴다) 패는 그 위에 그냥 놓인다. */}
              <div className="sutda-mat-surface" aria-hidden="true" />
              <div className="sutda-mat-lamp" aria-hidden="true" />
              {/* The hwatu deck on the mat — also the [data-deck-shoe] anchor every dealt
                  card visibly flies out of (lib/shoeFlight). */}
              <div className="sutda-deck" data-deck-shoe aria-hidden="true">
                <span className="hwatu-card hwatu-back" />
                <span className="hwatu-card hwatu-back" />
              </div>
              {/* NOTE: not .sutda-center — that class still carries the dead v1 medallion
                  rule in styles.css (gold border-radius:50%) and reusing it redraws it. */}
              {snapshot.lastWinners.length > 0 && (
                <div className="sutda-callout">
                  <strong>{snapshot.lastWinners[0]!.handLabel}</strong>
                  {snapshot.lastDdaeng && <span>{snapshot.lastDdaeng} 땡값</span>}
                </div>
              )}
              <div className="holdem-board sutda-pot-zone">
                {cashBills > 0 && snapshot.lastWinners.length === 0 && (
                  <div className="sutda-cash" aria-hidden="true">
                    {Array.from({ length: cashBills }).map((_, index) => <i key={index} />)}
                  </div>
                )}
                <div className="holdem-pot">{snapshot.pot.amount > 0 && snapshot.lastWinners.length === 0 && <span>팟 {snapshot.pot.amount.toLocaleString()}</span>}</div>
                {snapshot.street && snapshot.street !== "showdown" && (
                  <div className="sutda-street">{snapshot.street === "first" ? "1차 베팅 · 첫 패" : "2차 베팅 · 둘째 패"}</div>
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
                  showdown={snapshot.street === "showdown"}
                  squeezed={squeezed}
                  onSqueeze={() => setSqueezed(true)}
                  myTurn={myTurn}
                  winnerLabel={winnerBySeat.get(seat.seatNumber) ? `WIN +${winnerBySeat.get(seat.seatNumber)!.amount.toLocaleString()}` : null}
                />
              ))}
              {myTurn && (
                <div className={`ot-timer holdem-timer ${closing ? "closing" : ""}`}>
                  <svg viewBox="0 0 60 60"><circle className="ot-timer-track" cx="30" cy="30" r="26" /><circle className="ot-timer-ring" cx="30" cy="30" r="26" style={{ strokeDashoffset: timerOffset }} /></svg>
                  <span className="ot-timer-num">{seconds}</span>
                </div>
              )}
            </div>
            {!mine && (
              <div className="felt-prompt">
                빈 자리를 눌러 앉으세요
                <small>앉으려면 최소 {(snapshot.room.minBet * 2).toLocaleString()}코인 필요 · 관전은 자유</small>
              </div>
            )}
            {message && <p className="ot-message">{message}</p>}
          </div>

          <aside className="holdem-rail-v4" aria-label="섯다 액션">
            <StepBar steps={ROUND_STEPS} shortSteps={ROUND_STEPS_SHORT} current={step} ariaLabel="이번 판 진행 단계" />

            {/* My live 족보 with a strength read. Private by nature: the read only ever
                looks at the viewer's own cards (lib/sutdaHandRead). */}
            {mine && myRead && (
              <div className={`holdem-hand-panel sutda-hand-panel ${myRead.complete ? "" : "is-hint"}`}>
                <header>
                  <span className="holdem-hand-panel-eyebrow">내 족보</span>
                  <span className="holdem-hand-panel-private">나만 보여요</span>
                </header>
                <div className="holdem-hand-panel-body">
                  <div className="holdem-hand-panel-cards sutda-panel-cards" aria-hidden="true">
                    {mine.cards?.map((card) => <HwatuCard key={card.id} card={card} />)}
                    {!myRead.complete && <span className="hwatu-card hwatu-back is-pending" />}
                  </div>
                  <div className="holdem-hand-panel-text">
                    <strong>{myRead.label}</strong>
                    <span>{myRead.detail}</span>
                  </div>
                </div>
                {myRead.complete && myRead.tier && (
                  <>
                    <HandStrengthMeter tier={myRead.meter} label={myRead.meterLabel} detail={myRead.tierLabel} />
                    {myRead.strengthLine && <p className="hand-panel-line">{myRead.strengthLine}</p>}
                  </>
                )}
                {myRead.specialLine && <p className="hand-panel-line is-special">{myRead.specialLine}</p>}
                {!myRead.complete && myRead.outlook.length > 0 && (
                  <p className="hand-panel-outlook">
                    <small>둘째 패로 노려볼 패</small>
                    {myRead.outlook.map((entry) => (
                      <span key={entry.label} className={`tier-${entry.tier}`}>{entry.label}<em>{entry.months.map((month) => `${month}월`).join("·")}</em></span>
                    ))}
                  </p>
                )}
                <button type="button" className="hand-panel-link" onClick={() => openGameGuide("rankings")}>족보표 전체 보기</button>
              </div>
            )}

            {snapshot.lastResults.length > 0 && snapshot.room.phase !== "PLAYER_TURN" && (
              <SutdaResultBoard rows={snapshot.lastResults} rake={snapshot.lastRake} ddaeng={snapshot.lastDdaeng} mySeat={snapshot.mySeatNumber} />
            )}

            <div className="holdem-rail-meta">
              <span>팟 <b>{snapshot.pot.amount.toLocaleString()}</b></span>
              {mine && inHand && <span>내 베팅 <b>{mine.totalContributed.toLocaleString()}</b></span>}
              {myTurn && toCall > 0 && <span>콜 <b className="gold">{toCall.toLocaleString()}</b></span>}
            </div>

            {mine && myTurn && (
              <>
                <div className={`turn-strip ${closing ? "is-closing" : ""}`} role="status" aria-live="polite">
                  <div>
                    <strong>내 차례예요</strong>
                    <small>{toCall > 0 ? `콜 ${toCall.toLocaleString()} 또는 다이 · 하프로 올릴 수도 있어요` : "체크로 넘기거나 하프로 올릴 수 있어요"}</small>
                  </div>
                  <b>{seconds}</b>
                  <span className="turn-strip-bar" style={{ width: `${Math.min(100, (seconds / ACTION_SECONDS) * 100)}%` }} aria-hidden="true" />
                </div>
                {/* 표준 섯다 베팅 세트 — 다이·체크·콜·삥·따당·쿼터·하프·올인. 금액과 활성 여부는
                    서버가 계산해 내려준 그대로다. */}
                <div className="sutda-act-grid">
                  {betOptions.map((option) => (
                    <ActionButton
                      key={option.action}
                      label={option.amount > 0 ? `${option.label} ${option.amount.toLocaleString()}` : option.label}
                      hint={option.enabled ? ACTION_HINT[option.action] : option.reason ?? "지금은 불가"}
                      tone={ACTION_TONE[option.action]}
                      onClick={() => command(option.action)}
                      disabled={!option.enabled}
                      title={option.raiseBy > 0 ? `콜 ${toCall.toLocaleString()} + 올리기 ${option.raiseBy.toLocaleString()}` : undefined}
                    />
                  ))}
                </div>
              </>
            )}

            {!myTurn && snapshot.room.phase !== "WAITING" && (
              <>
                <p className="holdem-rail-status">{railStatus(snapshot, mine)}</p>
                {mine && mine.folded && <p className="rail-hint">이번 판은 다이했어요. 승부가 끝나면 다음 판에 자동으로 참여합니다.</p>}
                {mine && !mine.folded && mine.cardCount === 0 && snapshot.roundId && <p className="rail-hint">진행 중인 판이 끝나면 다음 판부터 참여해요.</p>}
              </>
            )}

            {mine && !myTurn && snapshot.room.phase === "WAITING" && (
              <div className="holdem-ready-dock">
                <span className="holdem-ready-status">{readyCount}/{seated}명 준비 완료</span>
                <button type="button" className={`outline-button ${mine.ready ? "bj-act-surrender" : "bj-act-hit"}`} onClick={ready}>
                  {mine.ready ? "준비 취소" : "준비 완료"}
                </button>
                <p className="rail-hint">
                  {seated < 2 ? <>상대가 한 명 더 앉으면 시작할 수 있어요</> : <>앉은 사람 <b>모두</b> 준비되면 자동 시작 · 삥 {snapshot.room.minBet}코인 자동 납부</>}
                </p>
              </div>
            )}

            {!mine && (
              <p className="rail-hint">테이블의 빈 자리를 누르면 참여할 수 있어요. 처음이라면 위의 <b>도움말</b>에서 족보표와 게임 방법을 확인하세요.</p>
            )}

            <SutdaLadder myLabel={myRead?.complete ? myRead.label : null} />

            <div className="holdem-rail-spacer" />

            <div className="holdem-rail-footer">
              <button type="button" className="outline-button" onClick={() => openGameGuide("rankings")}>족보표</button>
              {mine && (
                <button type="button" className="outline-button" onClick={stand} title={inHand ? "진행 중인 판을 포기하고 나갑니다" : undefined}>
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

function Seat({ seat, angle, canSit, onSit, isMine, showReady, showdown, winnerLabel, squeezed, onSqueeze, myTurn }: { seat: SutdaSeatSnapshot; angle: number; canSit: boolean; onSit: () => void; isMine: boolean; showReady: boolean; showdown: boolean; winnerLabel: string | null; squeezed: boolean; onSqueeze: () => void; myTurn: boolean }) {
  // Unit-circle position; the radii live in CSS so portrait and landscape can differ.
  const style = { "--sx": Math.cos((angle * Math.PI) / 180).toFixed(4), "--sy": Math.sin((angle * Math.PI) / 180).toFixed(4) } as CSSProperties;
  if (!seat.userId) {
    return canSit ? (
      <button className="holdem-seat holdem-seat-empty" style={style} onClick={onSit} aria-label={`${seat.seatNumber}번 좌석 앉기`}>
        <span>앉기</span>
      </button>
    ) : <div className="holdem-seat holdem-seat-empty" style={style} />;
  }
  return (
    <div className={`holdem-seat sutda-seat ${isMine ? "is-mine" : ""} ${seat.isTurn ? "is-turn" : ""} ${seat.folded ? "is-folded" : ""} ${seat.sittingOut ? "is-away" : ""} ${seat.allIn ? "is-allin" : ""} ${winnerLabel ? "is-winner" : ""}`} style={style}>
      <div className="holdem-seat-cards sutda-cards">
        {/* Faces for my own seat (and everyone's at showdown); otherwise exactly as many
            backs as the seat actually holds — 섯다 deals one card, bets, then the second. */}
        {seat.cards
          ? seat.cards.map((card, index) => (
              <FlyingHwatu key={card.id} delayMs={index * 200}>
                {isMine && index === 1 && !squeezed && !showdown
                  ? <CardSqueeze openNow={myTurn} onOpen={onSqueeze}><HwatuCard card={card} /></CardSqueeze>
                  : <HwatuCard card={card} />}
              </FlyingHwatu>
            ))
          : Array.from({ length: seat.cardCount }).map((_, index) => <FlyingHwatu key={index} delayMs={index * 200}><HwatuCard hidden /></FlyingHwatu>)}
      </div>
      <div className="holdem-seat-plate">
        <div className="holdem-seat-name">
          {seat.isDealer && <span className="holdem-button-chip is-seon" title="선 (이번 판의 기준 자리)">선</span>}
          <span className="holdem-seat-nick" title={seat.username ?? undefined}>{isMine ? "나" : seat.username}</span>
          {showReady && <span className={`holdem-ready-dot ${seat.ready ? "is-ready" : ""}`} title={seat.ready ? "준비 완료" : "준비 대기"} />}
        </div>
        <div className="holdem-seat-stack">{seat.stack.toLocaleString()}</div>
      </div>
      {seat.lastAction && !showdown && (
        <ActionBubble
          text={pickLine(SUTDA_LINES[seat.lastAction.action], seat.seatNumber, seat.lastAction.action, seat.lastAction.amount)}
          amount={seat.lastAction.amount}
          tone={seat.lastAction.action === "die" ? "out" : seat.lastAction.action === "check" || seat.lastAction.action === "call" ? "calm" : "push"}
        />
      )}
      <ChipStack amount={seat.totalContributed} label="베팅" />
      {seat.folded && <div className="holdem-seat-status fold">다이</div>}
      {!seat.folded && seat.allIn && <div className="holdem-seat-status allin">올인</div>}
      {winnerLabel && <div className="holdem-seat-status win">{winnerLabel}</div>}
      {!seat.folded && seat.handLabel && (showdown || !isMine) && (
        <div className="holdem-seat-status hand">{seat.handLabel}</div>
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

/** 0-based index into ROUND_STEPS, or -1 between hands. */
function roundStep(snapshot: SutdaRoomSnapshot): number {
  if (!snapshot.roundId && snapshot.room.phase === "WAITING") return -1;
  if (snapshot.street === "showdown" || snapshot.room.phase === "RESULT") return 4;
  if (snapshot.street === "final") return snapshot.room.phase === "DEALING" ? 2 : 3;
  return snapshot.room.phase === "DEALING" ? 0 : 1;
}

function railStatus(snapshot: SutdaRoomSnapshot, mine: SutdaSeatSnapshot | null): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  if (snapshot.room.phase === "DEALING") return snapshot.street === "final" ? "둘째 패를 나눠주고 있어요" : "첫 패를 나눠주고 있어요";
  if (snapshot.room.phase === "RESULT") return "족보를 비교하고 있어요";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님이 선택하는 중… ${mine && !mine.folded ? "곧 내 차례가 와요" : ""}`.trim();
  return "다른 자리의 선택을 기다리고 있어요";
}

function phaseLabel(snapshot: SutdaRoomSnapshot): string {
  if (snapshot.room.phase === "PLAYER_TURN") return snapshot.street === "final" ? "2차 베팅" : "1차 베팅";
  if (snapshot.room.phase === "DEALING") return snapshot.street === "final" ? "둘째 패 배분" : "첫 패 배분";
  if (snapshot.room.phase === "RESULT") return "승부 결과";
  return "플레이어 대기";
}

const ERROR_TEXT: Record<string, string> = {
  NOT_YOUR_TURN: "지금은 내 차례가 아니에요.",
  MUST_CALL_OR_DIE: "상대가 올렸어요. 콜 또는 다이를 선택하세요.",
  INSUFFICIENT_BALANCE: "잔액이 부족해요.",
  TABLE_LIMIT_REACHED: "테이블 최대 베팅 한도에 도달했어요.",
  SEAT_TAKEN: "이미 다른 사람이 앉은 자리예요.",
  ALREADY_SEATED: "이미 자리에 앉아 있어요.",
  NOT_SEATED: "먼저 자리에 앉아야 해요.",
  ROOM_JOIN_REQUIRED: "방에 다시 접속해주세요.",
};

function errorText(code: string): string {
  return ERROR_TEXT[code] ?? code;
}
