import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface GuideSection {
  id: string;
  /** Tab label — two or three words at most, it has to fit a phone-width tab strip. */
  title: string;
  content: ReactNode;
}

export interface GameGuideContent {
  /** Stable per-game identifier — which guide this is, not tied to any particular room. */
  gameKey: string;
  title: string;
  /** One sentence a first-timer reads before anything else. */
  intro: string;
  sections: GuideSection[];
}

/**
 * The in-game help sheet: 족보, how a round goes, and the words on the buttons —
 * everything a player who has never sat at this table needs, without leaving it.
 *
 * Portalled onto <body> so it clears the game shell's overflow:hidden; a bottom
 * sheet on phones and a centered panel on wider screens (CSS). The table keeps
 * running underneath — this is a reference, not a modal that pauses anything.
 */
export function GameGuide({ content, open, initialSection, onClose }: { content: GameGuideContent; open: boolean; initialSection?: string; onClose: () => void }) {
  const [active, setActive] = useState(content.sections[0]?.id ?? "");

  useEffect(() => {
    if (open) setActive(initialSection && content.sections.some((section) => section.id === initialSection) ? initialSection : content.sections[0]?.id ?? "");
  }, [open, initialSection, content.sections]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const section = content.sections.find((entry) => entry.id === active) ?? content.sections[0];

  return createPortal(
    <div className="game-guide-root" role="presentation">
      <div className="game-guide-scrim" onClick={onClose} aria-hidden="true" />
      <section className="game-guide" role="dialog" aria-modal="true" aria-label={`${content.title} 도움말`}>
        <header className="game-guide-head">
          <div>
            <h2>{content.title}</h2>
            <p>{content.intro}</p>
          </div>
          <button type="button" className="game-guide-close" onClick={onClose} aria-label="도움말 닫기"><X size={18} /></button>
        </header>
        <div className="game-guide-tabs" role="tablist" aria-label="도움말 항목">
          {content.sections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === section?.id}
              className={`game-guide-tab ${entry.id === section?.id ? "is-active" : ""}`}
              onClick={() => setActive(entry.id)}
            >
              {entry.title}
            </button>
          ))}
        </div>
        <div className="game-guide-body" role="tabpanel">
          {section?.content}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/* ── Small building blocks the per-game guide modules share ─────────────── */

/** Numbered "how a round goes" list. */
export function GuideSteps({ steps }: { steps: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="guide-steps">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span className="guide-step-num">{index + 1}</span>
          <div className="guide-step-text">
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "What each button does" — the tone class colours the chip like the real button. */
export function GuideActions({ actions }: { actions: Array<{ label: string; tone: string; body: ReactNode }> }) {
  return (
    <ul className="guide-actions">
      {actions.map((action) => (
        <li key={action.label}>
          <span className={`guide-action-chip ${action.tone}`}>{action.label}</span>
          <span className="guide-action-body">{action.body}</span>
        </li>
      ))}
    </ul>
  );
}

/** Glossary. */
export function GuideTerms({ terms }: { terms: Array<{ term: string; body: ReactNode }> }) {
  return (
    <dl className="guide-terms">
      {terms.map((entry) => (
        <div key={entry.term} className="guide-term">
          <dt>{entry.term}</dt>
          <dd>{entry.body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A tinted callout for the one thing a beginner most often gets wrong. */
export function GuideNote({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "red" | "green" }) {
  return <p className={`guide-note is-${tone}`}>{children}</p>;
}

/** Section heading inside a tab. */
export function GuideHeading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="guide-heading">
      <h3>{children}</h3>
      {sub && <span>{sub}</span>}
    </div>
  );
}
