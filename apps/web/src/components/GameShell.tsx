import { useEffect, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Expand, Minimize2 } from "lucide-react";
import { ProfileMenu } from "./ProfileMenu";
import { SoundToggle } from "./SoundToggle";
import { useCountUp } from "../lib/useCountUp";

/**
 * The in-game equivalent of AppShell: one slim bar (table name/limits + phase timer +
 * balance/sound/profile) instead of a separate site header stacked on top of the room's
 * own heading. Evolution-style — once you're at a table, the site chrome gets out of the way
 * and everything lives in a single strip so the felt below gets the rest of the viewport.
 */
export function GameShell({
  title,
  subtitle,
  phaseLabel,
  phaseSeconds,
  balance,
  onLogout,
  isFullscreen,
  onToggleFullscreen,
  shellRef,
  children,
}: {
  title: string;
  subtitle: string;
  phaseLabel: string;
  /** Seconds left in the current phase, or null when the phase has no deadline (WAITING). */
  phaseSeconds: number | string | null;
  balance: number;
  onLogout: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  shellRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const displayBalance = useCountUp(balance);

  useEffect(() => {
    document.body.classList.add("game-screen-active");
    return () => document.body.classList.remove("game-screen-active");
  }, []);

  return (
    <div className="game-shell" ref={shellRef}>
      <header className="game-bar">
        <Link className="game-back" to="/lobby" aria-label="게임 로비로 돌아가기">
          ←
        </Link>
        <div className="game-bar-title">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="game-bar-phase">
          <span>{phaseLabel}</span>
          {/* A countdown that has genuinely reached 0 must read "0", not "–". Only a phase
              with no deadline at all (WAITING) has nothing to show. */}
          <strong>{phaseSeconds === "" || phaseSeconds === null || phaseSeconds === undefined ? "–" : phaseSeconds}</strong>
        </div>
        <div className="game-bar-actions">
          <SoundToggle />
          <div className="balance-display" aria-label="현재 잔액">
            <strong>{displayBalance.toLocaleString()}코인</strong>
          </div>
          <button
            type="button"
            className="fullscreen-toggle"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "전체 화면 종료" : "전체 화면"}
            title={isFullscreen ? "전체 화면 종료" : "전체 화면"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
          </button>
          <ProfileMenu onLogout={onLogout} />
        </div>
      </header>
      <main className="game-body">{children}</main>
    </div>
  );
}
