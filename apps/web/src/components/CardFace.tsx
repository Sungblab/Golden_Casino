import type { Card } from "@golden/contracts";

const SUIT_GLYPH: Record<Card["suit"], string> = { H: "♥", D: "♦", C: "♣", S: "♠" };

/** CC0 OpenDecks artwork, served locally so every rank stays crisp at any size. */
export function CardFace({ card }: { card: Card }) {
  return (
    <img
      className="card-face-svg card-face-image"
      src={`/cards/opendecks/${card.rank}${card.suit}.svg`}
      alt={`${card.rank} ${SUIT_GLYPH[card.suit]}`}
      draggable={false}
    />
  );
}

/** Matching OpenDecks card back used for deal flips and the blackjack hole card. */
export function CardBackFace() {
  return <img className="card-face-svg card-face-image" src="/cards/opendecks/back.svg" alt="" aria-hidden="true" draggable={false} />;
}
