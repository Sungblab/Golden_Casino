import type { ReactNode } from "react";

/**
 * Small, shared pieces of the two player-vs-player tables (섯다, 홀덤). Both games
 * put the same three questions in front of a beginner — "how strong is what I
 * hold", "where are we in the round", and "what does this button do" — so the
 * answers are drawn the same way on both felts.
 */

/** Five-segment strength meter. `tier` is 1 (weakest) – 5 (strongest). */
export function HandStrengthMeter({ tier, label, detail }: { tier: number; label: string; detail?: ReactNode }) {
  const level = Math.max(1, Math.min(5, Math.round(tier)));
  return (
    <div className={`hand-meter tier-${level}`} role="img" aria-label={`패 강도 ${label}, 5단계 중 ${level}단계`}>
      <span className="hand-meter-bars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((step) => <i key={step} className={step <= level ? "is-on" : ""} />)}
      </span>
      <span className="hand-meter-label">{label}</span>
      {detail && <span className="hand-meter-detail">{detail}</span>}
    </div>
  );
}

/** Where the round is: "첫 패 → 베팅 → 둘째 패 → 베팅 → 승부". `current` is 0-based; -1 for none. */
export function StepBar({ steps, shortSteps, current, ariaLabel }: { steps: string[]; shortSteps?: string[]; current: number; ariaLabel: string }) {
  return (
    <ol className="step-bar" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li key={step} className={index < current ? "is-done" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}>
          <span className="step-full">{step}</span>
          {/* A narrower label for the landscape-phone rail, where five full words don't fit. */}
          <span className="step-short" aria-hidden="true">{shortSteps?.[index] ?? step}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * An action button that says what it does, not just what it's called: the big
 * word is the poker/섯다 term, the small line under it is plain Korean ("따라가기",
 * "포기"). `tone` picks the colour family every table uses for that action.
 */
export function ActionButton({ label, hint, tone, onClick, disabled, title }: { label: ReactNode; hint?: ReactNode; tone: "red" | "gold" | "blue" | "green" | "purple"; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className={`pvp-act tone-${tone}`} onClick={onClick} disabled={disabled} title={title}>
      <strong>{label}</strong>
      {hint && <small>{hint}</small>}
    </button>
  );
}
