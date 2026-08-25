import { useEffect, useState, type CSSProperties } from "react";
import type { Card } from "@golden/contracts";
import {
  CARD_BACK_URL,
  CardBackFace,
  CardFace,
  cardFaceUrl,
  isCardImageReady,
  preloadCardImage,
  preloadDeck,
} from "./CardFace";

/**
 * A local SVG playing card that flips from its back to its face shortly after
 * mounting. Callers control the dealing cadence by mounting one card at a time.
 *
 * `sideways` lays the card across the fan the way a dealer squares off a
 * baccarat third card or a blackjack double-down card; the rotation lives in CSS
 * (`--card-tilt`) so it survives the deal animation's own transform.
 */
export function PlayingCard({
  card,
  animate = true,
  delayMs = 40,
  sideways = false,
}: {
  card: Card;
  animate?: boolean;
  delayMs?: number;
  sideways?: boolean;
}) {
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => { preloadDeck(); }, []);
  /**
   * One effect owns the whole back -> face cycle, keyed on the card identity.
   * Splitting it in two (load, then reveal) is what put a permanently face-down
   * card on the table: when a split rewrote an existing slot's card while the
   * deck was already warm, the "assets ready" flag never changed value, so the
   * reveal timer never re-ran after this effect had reset `revealed` to false.
   */
  useEffect(() => {
    if (!animate) { setRevealed(true); return; }
    let cancelled = false;
    let timer = 0;
    setRevealed(false);
    const reveal = () => {
      if (!cancelled) timer = window.setTimeout(() => setRevealed(true), delayMs);
    };
    // A warmed deck starts the flip on this frame instead of after a network
    // round trip, so a dealt row reveals in dealing order rather than load order.
    if (isCardImageReady(cardFaceUrl(card)) && isCardImageReady(CARD_BACK_URL)) reveal();
    else void Promise.all([preloadCardImage(cardFaceUrl(card)), preloadCardImage(CARD_BACK_URL)]).then(reveal);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [animate, card.rank, card.suit, delayMs]);
  const style = animate ? ({ "--card-enter-delay": `${Math.max(0, delayMs - 40)}ms` } as CSSProperties) : undefined;
  return (
    <span className={`playing-card ${sideways ? "sideways" : ""}`} style={style}>
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
