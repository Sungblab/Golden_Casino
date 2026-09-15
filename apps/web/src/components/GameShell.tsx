import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { CircleHelp, Expand, Minimize2 } from "lucide-react";
import { GameGuide, hasSeenGuide, markGuideSeen, type GameGuideContent } from "./GameGuide";
import { ProfileMenu } from "./ProfileMenu";
import { SoundToggle } from "./SoundToggle";
import { useCountUp } from "../lib/useCountUp";

/**
 * The in-game equivalent of AppShell: one slim bar (table name/limits + phase timer +
 * balance/sound/profile) instead of a separate site header stacked on top of the room's
 * own heading. Evolution-style — once you're at a table, the site chrome gets out of the way
 * and everything lives in a single strip so the felt below gets the rest of the viewport.
 *
 * Every table also gets the same help button in the same place: the game's 족보 / rules /
 * glossary sheet (GameGuide), plus a one-time "처음이신가요?" nudge toward it. Putting it in
 * the shell rather than each room keeps "where is the help" identical across all five games.
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
  guide,
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
  guide?: GameGuideContent;
  children: ReactNode;
}) {
  const displayBalance = useCountUp(balance);
  /* On phones the felt's countdown ring is laid out away or hidden entirely, so this chip is
     the only countdown on screen - it has to carry the closing-soon urgency too. */
  const closing = typeof phaseSeconds === "number" && phaseSeconds <= 5;
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSection, setGuideSection] = useState<string | undefined>(undefined);
  const [tipVisible, setTipVisible] = useState(false);
  const gameKey = guide?.gameKey;

  useEffect(() => {
    document.body.classList.add("game-screen-active");
    return () => document.body.classList.remove("game-screen-active");
  }, []);

  // First visit to this game: nudge toward the guide a beat after the table has loaded, so
  // it never competes with the connecting screen. Dismissed or opened once → never again.
  useEffect(() => {
    if (!gameKey || hasSeenGuide(gameKey)) return;
    const timer = window.setTimeout(() => setTipVisible(true), 1_200);
    return () => window.clearTimeout(timer);
  }, [gameKey]);

  const openGuide = useCallback((section?: string) => {
    if (gameKey) markGuideSeen(gameKey);
    setTipVisible(false);
    setGuideSection(section);
    setGuideOpen(true);
  }, [gameKey]);
  const dismissTip = () => {
    if (gameKey) markGuideSeen(gameKey);
    setTipVisible(false);
  };

  // Rooms can open the guide on a specific tab (e.g. "족보표" from the hand panel) without
  // threading callbacks through every component: dispatch a DOM event on window.
  useEffect(() => {
    if (!guide) return;
    const handler = (event: Event) => openGuide((event as CustomEvent<{ section?: string }>).detail?.section);
    window.addEventListener("golden:open-guide", handler);
    return () => window.removeEventListener("golden:open-guide", handler);
  }, [guide, openGuide]);

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
        <div className={`game-bar-phase ${closing ? "is-closing" : ""}`}>
          <span>{phaseLabel}</span>
          {/* A countdown that has genuinely reached 0 must read "0", not "–". Only a phase
              with no deadline at all (WAITING) has nothing to show. */}
          <strong>{phaseSeconds === "" || phaseSeconds === null || phaseSeconds === undefined ? "–" : phaseSeconds}</strong>
        </div>
        <div className="game-bar-actions">
          {guide && (
            <div className="game-help-anchor">
              <button
                type="button"
                className={`game-help-button ${tipVisible ? "is-nudging" : ""}`}
                onClick={() => openGuide()}
                aria-label="게임 방법과 족보 보기"
                title="게임 방법 · 족보"
                aria-haspopup="dialog"
                aria-expanded={guideOpen}
              >
                <CircleHelp size={17} />
                <span>도움말</span>
              </button>
              {tipVisible && (
                <div className="game-help-tip" role="status">
                  <strong>{guide.title}{subjectParticle(guide.title)} 처음이신가요?</strong>
                  <span>게임 방법과 족보를 1분만 보고 시작해보세요.</span>
                  <div className="game-help-tip-actions">
                    <button type="button" className="game-help-tip-primary" onClick={() => openGuide()}>도움말 보기</button>
                    <button type="button" className="game-help-tip-secondary" onClick={dismissTip}>괜찮아요</button>
                  </div>
                </div>
              )}
            </div>
          )}
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
      {guide && <GameGuide content={guide} open={guideOpen} initialSection={guideSection} onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

/** 이/가 by whether the word ends in a 받침 — "섯다가", "홀덤이", "바카라가". */
function subjectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "이";
  return (last - 0xac00) % 28 === 0 ? "가" : "이";
}

/** Opens the shell's guide sheet from anywhere inside a room, optionally on one tab. */
export function openGameGuide(section?: string): void {
  window.dispatchEvent(new CustomEvent("golden:open-guide", { detail: { section } }));
}
