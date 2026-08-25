import { useEffect, useState, type CSSProperties } from "react";
import type { Card } from "@golden/contracts";
import { CARD_BACK_URL, CardBackFace, CardFace, cardFaceUrl, preloadCardImage } from "./CardFace";

/**
 * A local SVG playing card that flips from its back to its face shortly after
 * mounting. Callers control the dealing cadence by mounting one card at a time.
 */
export function PlayingCard({ card, animate = true, delayMs = 40 }: { card: Card; animate?: boolean; delayMs?: number }) {
  const [assetsReady, setAssetsReady] = useState(!animate);
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    let cancelled = false;
    setAssetsReady(false);
    setRevealed(false);
    void Promise.all([preloadCardImage(cardFaceUrl(card)), preloadCardImage(CARD_BACK_URL)]).then(() => {
      if (!cancelled) setAssetsReady(true);
    });
    return () => { cancelled = true; };
  }, [animate, card.rank, card.suit]);
  useEffect(() => {
    if (!animate || !assetsReady) return;
    const timer = window.setTimeout(() => setRevealed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [animate, assetsReady, delayMs]);
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
