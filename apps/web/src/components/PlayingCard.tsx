import { useEffect, useState, type CSSProperties } from "react";
import type { Card } from "@golden/contracts";
import { CardBackFace, CardFace } from "./CardFace";

/**
 * A local SVG playing card that flips from its back to its face shortly after
 * mounting. Callers control the dealing cadence by mounting one card at a time.
 */
export function PlayingCard({ card, animate = true, delayMs = 40 }: { card: Card; animate?: boolean; delayMs?: number }) {
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const timer = window.setTimeout(() => setRevealed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [animate, delayMs]);
  const style = animate ? ({ "--card-enter-delay": `${Math.max(0, delayMs - 40)}ms` } as CSSProperties) : undefined;
  return (
    <span className="playing-card" style={style}>
      <span className={`playing-card-inner ${revealed ? "is-revealed" : ""}`}>
        <span className="playing-card-back">
          <CardBackFace />
        </span>
        <span className="playing-card-face">
          <CardFace card={card} />
        </span>
      </span>
    </span>
  );
}
