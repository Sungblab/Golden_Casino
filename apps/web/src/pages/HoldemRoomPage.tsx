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
import { CardBackFace } from "../components/CardFace";
import { ChipStack } from "../components/ChipStack";
import { DeckShoe } from "../components/DeckShoe";
import { GameShell } from "../components/GameShell";
import { HoldemHandPanel } from "../components/HoldemHandPanel";
import { OrientationGate } from "../components/OrientationGate";
import { PlayingCard } from "../components/PlayingCard";
import { PokerHandGuide } from "../components/PokerHandGuide";
import { RoomChat } from "../components/RoomChat";
import { WinnerFeed } from "../components/WinnerFeed";
import { RoundResultNotice, type RoundResultNoticeData } from "../components/RoundResultNotice";
import { playSound } from "../lib/sound";
import { cardKey, readHoldemHand, HOLDEM_HAND_LABEL } from "../lib/holdemHandRead";
import { randomRequestId } from "../lib/requestId";

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
  const [resultNotice, setResultNotice] = useState<RoundResultNoticeData | null>(null);
  const noticeRoundRef = useRef<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const prevActingSeatRef = useRef<number | null>(null);
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

  // My own win banner — only fires for a hand I actually won, using the winner's credited
  // amount (reliable) rather than trying to net it against my contribution (not reliable to
  // reconstruct from the snapshot once the hand has settled).
  useEffect(() => {
    if (!snapshot?.roundId || snapshot.lastWinners.length === 0 || noticeRoundRef.current === snapshot.roundId) return;
    noticeRoundRef.current = snapshot.roundId;
    const mine = snapshot.lastWinners.find((winner) => winner.seatNumber === snapshot.mySeatNumber);
    if (!mine) return;
    setResultNotice({ net: mine.amount, amount: mine.amount, title: "승리했습니다" });
    playSound("win");
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setResultNotice(null), 3600);
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
  const myHandRead = mySeat?.folded ? null : readHoldemHand(mySeat?.holeCards ?? null, snapshot.board);
  const potTotal = snapshot.pots.reduce((sum, pot) => sum + pot.amount, 0);
  const timerOffset = TIMER_RING * (1 - Math.min(1, seconds / ACTION_SECONDS));

  const sit = (seatNumber: number) => {
    socket.emit("holdem.sit", { requestId: randomRequestId(), roomId, seatNumber }, (ack) => {
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
  // Pot-relative presets instead of a bare drag slider — one tap gets a legal sizing, the
  // stepper is only for fine adjustment from there. Korean poker rooms (한게임/피망) name
  // these 쿼터/하프/팟/맥스 and players expect that vocabulary, so the labels follow it
  // rather than inventing a second set of names for the same sizings.
  const raisePresets = [
    { key: "min", label: "MIN", value: minRaiseClamped },
    { key: "quarter", label: "쿼터", value: clampRaise(Math.round(potTotal / 4)) },
    { key: "half", label: "하프", value: clampRaise(Math.round(potTotal / 2)) },
    { key: "pot", label: "팟", value: clampRaise(potTotal) },
    { key: "max", label: "맥스", value: maxRaiseTo },
  ];
  const canRaise = maxRaiseTo > snapshot.toCall + (mySeat?.streetContributed ?? 0);
  const raiseValue = Math.min(raiseTo, maxRaiseTo);
  const readyCount = snapshot.seats.filter((seat) => seat.userId && seat.ready).length;
  const seatedCount = snapshot.seats.filter((seat) => seat.userId).length;

  return (
    <GameShell
      title={snapshot.room.name}
      subtitle={`BLIND ${snapshot.room.minBet}/${bigBlind} · MAX ${snapshot.room.maxBet}`}
      phaseLabel={snapshot.room.paused
        ? "일시정지"
        // WAITING *with* a deadline is the between-hands break the server holds open so a player
        // can stand up; without one it's the ordinary "nobody is ready yet" idle.
        : snapshot.room.phase === "WAITING" && snapshot.phaseEndsAt
          ? "다음 핸드까지"
          : phaseLabel(snapshot.room.phase, snapshot.street)}
      // The felt's own ring timer already shows the countdown on my turn — showing it a
      // second time up in the bar was redundant. Other players' turns (no ring for me) still show it.
      phaseSeconds={snapshot.phaseEndsAt ? seconds : null}
      balance={snapshot.walletBalance}
      onLogout={onLogout}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : shellRef.current?.requestFullscreen())}
      shellRef={shellRef}
    >
      <OrientationGate targetRef={shellRef} />
      {/* Table on the left, action rail on the right. The actions used to be a dock floating
          over the bottom of the felt, which covered the player's own cards at exactly the
          moment they mattered; giving them their own column means the felt is never occluded
          and the table gets the full height instead of reserving 148px for the dock. */}
      <div className="room-shell holdem-room-shell">
        <section className="ot-stage">
          <div className="ot-felt holdem-felt">
            <div className="ot-feed"><WinnerFeed socket={socket} /></div>
            <RoundResultNotice notice={resultNotice} />
            <div className="holdem-table">
              <DeckShoe />
              {/* Decorative table rail — purely visual, drawn once behind the live board/seats.
                  A plain CSS ellipse (border-radius: 50% on a box sized to match the seats' own
                  radius/0.72 squish), so it lines up with them at any viewport. An earlier version
                  also drew a spoke line from dead-center to every seat — with 6 seats that's 6
                  lines converging on one point, which reads as a cluttered asterisk instead of
                  table wedges, so it's gone; the inner action-line ellipse below reads as "a table"
                  on its own without needing spokes at all. */}
              <div className="holdem-table-rail" aria-hidden="true" />
              <div className="holdem-action-line" aria-hidden="true" />
              <div className="holdem-table-brand" aria-hidden="true">TEXAS HOLD&apos;EM</div>
              <div className="holdem-board">
                <div className="holdem-pot">{potTotal > 0 && <span>POT {potTotal.toLocaleString()}</span>}</div>
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
                        {winner.username} +{winner.amount.toLocaleString()}{winner.handCategory ? ` (${HOLDEM_HAND_LABEL[winner.handCategory]})` : ""}
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

          {/* The action rail — the right-hand column at every viewport, narrower and denser
              below 900px/560px (see table-holdem.css) rather than moving to a bottom bar.
              Always a sibling of the felt, never an overlay on it. */}
          <aside className="holdem-rail-v4" aria-label="홀덤 액션">
            {myHandRead && mySeat?.holeCards && (
              <HoldemHandPanel read={myHandRead} holeCards={mySeat.holeCards} />
            )}

            <div className="holdem-rail-meta">
              <span>POT <b>{potTotal.toLocaleString()}</b></span>
              {myTurn && snapshot.toCall > 0 && <span>콜 <b className="gold">{Math.min(snapshot.toCall, mySeat?.stack ?? 0).toLocaleString()}</b></span>}
            </div>

            {mySeat && myTurn && (
              <>
                {canRaise && (
                  <>
                    {/* One tap bets/raises at that sizing — the 한게임/피망 bar behavior these
                        labels come from; a select-then-confirm preset made the same move cost
                        two taps and read as broken to players used to those rooms. The stepper
                        below stays the two-step path for custom amounts. */}
                    <div className="holdem-presets">
                      {raisePresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.key}
                          className="holdem-preset"
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
                  <button className="outline-button bj-act-surrender" onClick={() => act("fold")}>폴드</button>
                  {snapshot.toCall === 0
                    ? <button className="outline-button bj-act-stand" onClick={() => act("check")}>체크</button>
                    : <button className="outline-button bj-act-double" onClick={() => act("call")}>콜 {Math.min(snapshot.toCall, mySeat.stack).toLocaleString()}</button>}
                  {canRaise && (
                    <button className="outline-button bj-act-hit" onClick={() => act(snapshot.toCall === 0 ? "bet" : "raise", raiseValue)}>
                      {snapshot.toCall === 0 ? "베팅" : "레이즈"} {raiseValue.toLocaleString()}
                    </button>
                  )}
                  {maxRaiseTo > 0 && <button className="outline-button bj-act-split" onClick={() => act("allin")}>올인 {maxRaiseTo.toLocaleString()}</button>}
                </div>
              </>
            )}

            {/* Without this the rail was a tall empty box for most of a hand — every beat spent
                waiting on someone else's action rendered nothing between the pot line and the
                footer. Say whose turn it is instead. */}
            {!myTurn && snapshot.room.phase !== "WAITING" && (
              <p className="holdem-rail-status">{railStatus(snapshot)}</p>
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
              </div>
            )}

            {/* Fills the gap between the actions and the footer controls on desktop; a no-op
                in the bottom-bar layout, where the rail is a row. */}
            <div className="holdem-rail-spacer" />

            <div className="holdem-rail-footer">
              <PokerHandGuide />
              {mySeat && (
                <button
                  type="button"
                  className="outline-button holdem-rail-secondary"
                  onClick={standUp}
                  disabled={!!snapshot.roundId && mySeat.totalContributed > 0 && !mySeat.folded}
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

function SeatView({ seat, angle, onSit, canSit, isMine, highlightKeys, showReady }: { seat: HoldemSeatSnapshot; angle: number; onSit: () => void; canSit: boolean; isMine: boolean; highlightKeys?: Set<string>; showReady: boolean }) {
  // Separate x/y radii (rather than one radius with a squish factor) because the table box now
  // fills the game screen instead of holding a fixed aspect ratio: the seats have to reach the
  // rail on both axes, and the rail's own inset is what these are tuned against — see
  // .holdem-table-rail in styles.css. Percentages of the table box, so they track any viewport.
  const x = 50 + 45 * Math.cos((angle * Math.PI) / 180);
  // The y radius is deliberately well short of the x radius. A seat is centred on its point, so
  // half of it sits beyond the point — and an occupied seat (cards + name + stack + status line)
  // measures ~135px against a table only ~630px high.
  //
  // 33% is the value that clears BOTH edges for the top/bottom-centre seats, which are the only
  // two with anything above and below them: at 31% an occupied seat overlapped the action-line
  // ellipse by ~35px ("선에 걸려"), and pushing it further out to fix that would have run it into
  // the rail instead. 33% leaves ~15px of felt on each side, and .holdem-action-line was pulled
  // in to match (see table-holdem.css) — the two numbers are a pair; changing one alone
  // reintroduces the overlap.
  const y = 50 + 33 * Math.sin((angle * Math.PI) / 180);
  const style = { left: `${x}%`, top: `${y}%` };
  if (!seat.userId) {
    return canSit ? (
      <button className="holdem-seat holdem-seat-empty" style={style} onClick={onSit}>
        <span>착석</span>
      </button>
    ) : <div className="holdem-seat holdem-seat-empty" style={style} />;
  }
  return (
    <div className={`holdem-seat ${isMine ? "is-mine" : ""} ${seat.isTurn ? "is-turn" : ""} ${seat.folded ? "is-folded" : ""} ${seat.sittingOut ? "is-away" : ""}`} style={style}>
      <div className="holdem-seat-cards">
        {/* Three distinct states, which the old markup collapsed into two: my own (or a
            revealed showdown) hand shows faces; an opponent who was dealt in but is still
            hidden shows card BACKS — previously an empty dashed slot, indistinguishable from
            a seat that was never dealt in at all; and only a genuinely undealt seat shows
            the slot. */}
        {seat.holeCards
          ? seat.holeCards.map((card, index) => (
            <PlayingCard
              key={index}
              card={card}
              animate={false}
              highlighted={highlightKeys?.has(cardKey(card)) ?? false}
            />
          ))
          : Array.from({ length: 2 }).map((_, index) => (
            seat.dealtIn
              ? <span key={index} className="playing-card holdem-hole-back"><span className="playing-card-inner"><span className="playing-card-back"><CardBackFace /></span></span></span>
              : <span key={index} className="ot-card-slot holdem-hole-slot" />
          ))}
      </div>
      {/* Name + stack share one dark nameplate, the way every real client draws seats —
          bare text floating on felt is what made the table read as a mock-up. The card row
          above overlaps its top edge slightly (CSS), like cards resting against the plate. */}
      <div className="holdem-seat-plate">
        <div className="holdem-seat-name">
          {seat.isButton && <span className="holdem-button-chip">D</span>}
          {/* The nickname needs its own element: `text-overflow: ellipsis` has no effect on a flex
              container, so as a bare text node it was hard-clipped mid-character and pushed the
              dealer chip / ready dot out of the seat entirely. */}
          <span className="holdem-seat-nick" title={seat.username ?? undefined}>{seat.username}</span>
          {showReady && <span className={`holdem-ready-dot ${seat.ready ? "is-ready" : ""}`} title={seat.ready ? "준비 완료" : "준비 대기"} />}
        </div>
        <div className="holdem-seat-stack">{seat.stack.toLocaleString()}</div>
      </div>
      <ChipStack amount={seat.streetContributed} label="베팅" />
      {seat.folded && <div className="holdem-seat-status fold">폴드</div>}
      {seat.allIn && !seat.folded && <div className="holdem-seat-status allin">올인</div>}
      {/* Only a showdown reveal now — my own live read moved to the rail's hand panel, where
          it has room for the supporting detail and doesn't grow the seat mid-hand. */}
      {!seat.folded && seat.handCategory && (
        <div className="holdem-seat-status">{HOLDEM_HAND_LABEL[seat.handCategory]}</div>
      )}
    </div>
  );
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
function railStatus(snapshot: HoldemRoomSnapshot): string {
  if (snapshot.room.paused) return "테이블이 일시정지되었습니다";
  if (snapshot.room.phase === "DEALING") {
    if (snapshot.street === "preflop" || !snapshot.street) return "카드를 나눠주고 있습니다";
    const street = STREET_LABEL[snapshot.street] ?? snapshot.street;
    return `${street}${objectParticle(street)} 여는 중입니다`;
  }
  if (snapshot.room.phase === "SETTLING" || snapshot.room.phase === "RESULT") return "패를 비교하고 있습니다";
  const acting = snapshot.seats.find((seat) => seat.seatNumber === snapshot.actingSeat);
  if (acting?.username) return `${acting.username}님의 차례입니다`;
  return "다른 자리의 선택을 기다리고 있습니다";
}

function phaseLabel(phase: HoldemRoomSnapshot["room"]["phase"], street: HoldemRoomSnapshot["street"]): string {
  if (phase === "PLAYER_TURN") return "베팅 진행 중";
  if (phase === "DEALING") return street === "preflop" || !street ? "카드 딜링" : `${STREET_LABEL[street] ?? street} 오픈`;
  if (phase === "SETTLING") return "쇼다운";
  if (phase === "RESULT") return "핸드 종료";
  return "플레이어 대기";
}

const STREET_LABEL: Record<string, string> = { preflop: "프리플랍", flop: "플랍", turn: "턴", river: "리버", showdown: "쇼다운" };
