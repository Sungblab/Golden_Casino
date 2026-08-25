import type { Card } from "@golden/contracts";

const SUIT_GLYPH: Record<Card["suit"], string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
export const CARD_BACK_URL = "/cards/opendecks/back.svg";

const imageLoads = new Map<string, Promise<void>>();

export function cardFaceUrl(card: Card): string {
  return `/cards/opendecks/${card.rank}${card.suit}.svg`;
}

export function preloadCardImage(src: string): Promise<void> {
  const existing = imageLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
  imageLoads.set(src, promise);
  return promise;
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
