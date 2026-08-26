import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Card } from "@golden/contracts";
import { applyShoeFlight, SHOE_REVEAL_HOLD_MS } from "../lib/shoeFlight";
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
 *
 * `highlighted` marks a card as part of the viewer's current best hand (gold
 * ring) — holdem uses it on the hole/board cards the evaluated combo uses.
 * `lightningMultiplier` marks a card selected by the Lightning round and shows
 * the multiplier on the physical card when it is revealed.
 */
export function PlayingCard({
  card,
  animate = true,
  delayMs = 40,
  sideways = false,
  highlighted = false,
  lightningMultiplier,
}: {
  card: Card;
  animate?: boolean;
  delayMs?: number;
  sideways?: boolean;
  highlighted?: boolean;
  lightningMultiplier?: number;
}) {
  const [revealed, setRevealed] = useState(!animate);
  const rootRef = useRef<HTMLSpanElement>(null);
  /** Read by the reveal effect below — layout effects always run before it. */
  const flightMsRef = useRef(0);
  useEffect(() => { preloadDeck(); }, []);
  // On a shoe table the card launches from the shoe's real position, and the
  // flip below waits for touchdown; elsewhere flight is 0 and nothing changes.
  useLayoutEffect(() => {
    flightMsRef.current = animate ? applyShoeFlight(rootRef.current) : 0;
  }, [animate, card.rank, card.suit]);
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
    // A shoe-dealt card stays face-down through the whole flight, rests for a
    // beat after touchdown, then starts its slower turn. Without a measured
    // flight this keeps the original lightweight delay for non-shoe cards.
    const revealDelay = flightMsRef.current > 0
      ? delayMs + flightMsRef.current + SHOE_REVEAL_HOLD_MS
      : delayMs;
    const reveal = () => {
      if (!cancelled) timer = window.setTimeout(() => setRevealed(true), revealDelay);
    };
    // A warmed deck starts the flip on this frame instead of after a network
    // round trip, so a dealt row reveals in dealing order rather than load order.
    if (isCardImageReady(cardFaceUrl(card)) && isCardImageReady(CARD_BACK_URL)) reveal();
    else void Promise.all([preloadCardImage(cardFaceUrl(card)), preloadCardImage(CARD_BACK_URL)]).then(reveal);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [animate, card.rank, card.suit, delayMs]);
  const style = animate ? ({ "--card-enter-delay": `${Math.max(0, delayMs - 40)}ms` } as CSSProperties) : undefined;
  return (
    <span
      ref={rootRef}
      className={`playing-card ${sideways ? "sideways" : ""} ${highlighted ? "is-in-hand" : ""} ${lightningMultiplier ? "is-lightning-hit" : ""}`}
      style={style}
    >
      <span className={`playing-card-inner ${revealed ? "is-revealed" : ""}`}>
        <span className="playing-card-back">
          <CardBackFace />
        </span>
        <span className="playing-card-face">
          <CardFace card={card} />
          {lightningMultiplier && <b className="playing-card-lightning-badge">×{lightningMultiplier}</b>}
        </span>
      </span>
    </span>
  );
}
