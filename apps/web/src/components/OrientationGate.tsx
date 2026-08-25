import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { RotateCw } from "lucide-react";

/**
 * Blackjack and Hold'em only make sense laid out wide (a seat row / an oval table) — there's
 * no good portrait layout for either, so instead of building one we block portrait outright
 * and ask the player to rotate.
 *
 * There is no reliable way to *force* landscape from the page: `screen.orientation.lock()` is
 * unsupported on iOS Safari entirely, and on Chromium it only works once the page is already
 * fullscreen. So "rotate" button below does the best available thing — request fullscreen on
 * the game shell, then attempt the lock — and silently no-ops where the browser won't allow it,
 * leaving the player to rotate their phone by hand (as they would anyway).
 *
 * Rendered via portal straight onto `document.body` so it always covers the full viewport
 * regardless of any `overflow: hidden` on ancestors (`.game-shell`/`.game-body` both clip).
 */
export function OrientationGate({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px) and (orientation: portrait)");
    const update = () => setBlocked(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!blocked) return null;

  const requestLandscape = async (): Promise<void> => {
    try {
      const el = targetRef.current ?? document.documentElement;
      if (!document.fullscreenElement) await el.requestFullscreen();
      // Not all browsers expose the Orientation Lock API (notably iOS Safari) — treat it as
      // optional and let the catch below swallow the rejection either way.
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
        .lock?.("landscape");
    } catch {
      // Fullscreen denied, lock unsupported, or user's OS has rotation locked — nothing more
      // we can do from the page; the on-screen copy already tells them to rotate manually.
    }
  };

  return createPortal(
    <div className="orientation-gate" role="alertdialog" aria-label="가로 모드로 전환해주세요">
      <div className="orientation-gate-icon" aria-hidden="true">
        <RotateCw size={30} />
      </div>
      <strong>화면을 가로로 돌려주세요</strong>
      <p>
        이 테이블은 가로 화면 전용입니다.
        <br />
        기기의 화면 회전 잠금이 켜져 있다면 먼저 해제해주세요.
      </p>
      <button type="button" className="orientation-gate-button" onClick={() => void requestLandscape()}>
        전체 화면으로 전환
      </button>
    </div>,
    document.body,
  );
}
