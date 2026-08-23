import { useEffect, useState } from "react";
import type { Card } from "@golden/contracts";
import { CardBackFace, CardFace } from "./CardFace";

/**
 * A self-drawn SVG playing card (see CardFace.tsx) that flips from its back to its
 * face shortly after mounting. Callers control the "dealing" cadence by mounting one
 * card at a time (see Hand.tsx) rather than this component animating on its own.
 */
export function PlayingCard({ card, animate = true }: { card: Card; animate?: boolean }) {
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const timer = window.setTimeout(() => setRevealed(true), 40);
    return () => window.clearTimeout(timer);
  }, [animate]);
  return (
    <span className="playing-card">
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
