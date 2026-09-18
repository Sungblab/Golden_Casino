import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* ===========================================================================
   PvP 테이블을 살아 있게 만드는 두 조각 — 섯다와 홀덤이 함께 쓴다.
   (처음엔 섯다 전용으로 만들었다가, 같은 것이 홀덤에도 그대로 필요해서 옮겼다.)
   =========================================================================== */

/**
 * 말풍선 — 액션을 "콜"이라고 적는 대신 사람이 할 법한 말로 던진다. 같은 상황에서 매번
 * 같은 말이 나오면 금방 기계처럼 보이므로 여러 줄을 두되, 좌석·액션·금액으로 고정 선택한다
 * (리렌더마다 말이 바뀌면 산만하다).
 */
export function pickLine(lines: string[], seatNumber: number, action: string, amount: number): string {
  return lines[(seatNumber * 7 + amount * 3 + action.length) % lines.length]!;
}

/** 내 차례가 온 뒤 패가 저절로 열리기까지의 여유. 쪼을 사람은 이 사이에 쪼고, 아무것도
 *  안 해도 곧 열리므로 패를 못 본 채 베팅하게 되는 일은 없다. */
const TURN_GRACE_MS = 1100;

export type BubbleTone = "calm" | "push" | "out";

export function ActionBubble({ text, amount, tone }: { text: string; amount?: number; tone: BubbleTone }) {
  return (
    <div className={`table-bubble tone-${tone}`} role="status">
      {text}
      {amount !== undefined && amount > 0 && <b>{amount.toLocaleString()}</b>}
    </div>
  );
}

/**
 * 쪼기 — 패를 엎어 두고 눌러서 모서리부터 들어올린다. 섯다의 그 동작이고, 홀덤 클라이언트도
 * 같은 걸 "squeeze"라고 부른다.
 *
 * 절대 판을 막지 않는 게 원칙이다: 손대지 않아도 잠시 뒤 저절로 열리고, 내 차례가 오면
 * 즉시 열린다. 쪼는 맛은 덤이지 관문이 아니다. (그래서 브라우저 탭이 백그라운드로 내려가
 * requestAnimationFrame 이 멈춰도 타이머가 열어 준다.)
 */
export function CardSqueeze({ children, autoOpenMs = 3200, openNow, onOpen, hint = "눌러서 쪼기" }: {
  children: ReactNode;
  autoOpenMs?: number;
  /** 내 차례가 되면 기다리지 않고 연다 — 패를 못 본 채 베팅하게 두면 안 된다. */
  openNow: boolean;
  onOpen: () => void;
  hint?: string;
}) {
  const [lift, setLift] = useState(0);
  const [open, setOpen] = useState(false);
  const holding = useRef(false);
  const raf = useRef<number | null>(null);
  const opened = useRef(false);

  const finish = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    setOpen(true);
    onOpen();
  }, [onOpen]);

  // 내 차례가 왔다고 그 자리에서 까 버리면 쪼는 순간이 통째로 사라진다 — 헤즈업 홀덤은
  // 프리플랍에 버튼이 먼저 행동하므로 매 핸드가 그랬다. 짧은 여유를 주고 연다.
  useEffect(() => {
    if (!openNow) return;
    const timer = window.setTimeout(finish, TURN_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [openNow, finish]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    const timer = window.setTimeout(finish, autoOpenMs);
    return () => window.clearTimeout(timer);
  }, [autoOpenMs, finish]);

  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);

  const step = useCallback(() => {
    setLift((current) => {
      const next = holding.current ? Math.min(1, current + 0.055) : Math.max(0, current - 0.085);
      if (next >= 1) { finish(); return 1; }
      if (next > 0 || holding.current) raf.current = requestAnimationFrame(step);
      return next;
    });
  }, [finish]);

  const start = (event: React.PointerEvent) => {
    event.preventDefault();
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* 캡처 실패는 무시 — 놓는 순간을 못 받을 뿐이다 */ }
    holding.current = true;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  };
  const stop = () => {
    holding.current = false;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  };

  return (
    <span
      className={`table-squeeze ${open ? "is-open" : ""} ${lift > 0 ? "is-lifting" : ""}`}
      onPointerDown={open ? undefined : start}
      onPointerUp={stop}
      onPointerCancel={stop}
      style={{ "--lift": lift } as React.CSSProperties}
    >
      {children}
      {!open && <span className="table-squeeze-cover" aria-hidden="true" />}
      {!open && lift === 0 && <span className="table-squeeze-hint">{hint}</span>}
    </span>
  );
}
