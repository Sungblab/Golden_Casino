import type { Card } from "@golden/contracts";

const SUIT_GLYPH: Record<Card["suit"], string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
export const CARD_BACK_URL = "/cards/opendecks/back.svg";

const RANKS: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Card["suit"][] = ["H", "D", "C", "S"];

const imageLoads = new Map<string, Promise<void>>();
const imageReady = new Set<string>();

export function cardFaceUrl(card: Card): string {
  return `/cards/opendecks/${card.rank}${card.suit}.svg`;
}

/** True once the asset is decoded, so a card can render its face without a wait tick. */
export function isCardImageReady(src: string): boolean {
  return imageReady.has(src);
}

export function preloadCardImage(src: string): Promise<void> {
  const existing = imageLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    const done = () => { imageReady.add(src); resolve(); };
    image.onload = done;
    image.onerror = done;
    image.src = src;
  });
  imageLoads.set(src, promise);
  return promise;
}

let deckWarmed = false;
/**
 * Warm the whole 52-card deck (plus the back) once per session, off the critical
 * path. Without this the first appearance of any rank waits on its own network
 * round trip, so an opening deal reveals its cards in load order rather than in
 * dealing order. Room pages call this on mount.
 */
export function preloadDeck(): void {
  if (deckWarmed || typeof window === "undefined") return;
  deckWarmed = true;
  const warm = () => {
    void preloadCardImage(CARD_BACK_URL);
    for (const rank of RANKS) for (const suit of SUITS) void preloadCardImage(`/cards/opendecks/${rank}${suit}.svg`);
  };
  const idle = (window as typeof window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(warm);
  else window.setTimeout(warm, 300);
}

/** CC0 OpenDecks artwork, served locally so every rank stays crisp at any size. */
export function CardFace({ card }: { card: Card }) {
  return (
    <img
      className="card-face-svg card-face-image"
      src={cardFaceUrl(card)}
      alt={`${card.rank} ${SUIT_GLYPH[card.suit]}`}
      draggable={false}
    />
  );
}

/** Matching OpenDecks card back used for deal flips and the blackjack hole card. */
export function CardBackFace() {
  return <img className="card-face-svg card-face-image" src={CARD_BACK_URL} alt="" aria-hidden="true" draggable={false} />;
}
