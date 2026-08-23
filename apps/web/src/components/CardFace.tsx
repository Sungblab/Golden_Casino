import type { Card } from "@golden/contracts";

const SUIT_GLYPH: Record<Card["suit"], string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
const RED_SUITS = new Set<Card["suit"]>(["H", "D"]);

/**
 * A card face drawn entirely with our own SVG — no third-party card-image library.
 * Corner pips (rank + suit) plus a large center suit glyph, casino-standard layout.
 */
export function CardFace({ card }: { card: Card }) {
  const isRed = RED_SUITS.has(card.suit);
  const glyph = SUIT_GLYPH[card.suit];
  const color = isRed ? "#c81e2c" : "#141414";
  return (
    <svg viewBox="0 0 64 90" className="card-face-svg" role="img" aria-label={`${card.rank} ${glyph}`}>
      <rect x="1" y="1" width="62" height="88" rx="7" fill="#fbf6e8" stroke="#d9cba3" strokeWidth="1.5" />
      <text x="6" y="16" fontSize="12" fontWeight="700" fill={color}>
        {card.rank}
      </text>
      <text x="6" y="27" fontSize="11" fill={color}>
        {glyph}
      </text>
      <text x="58" y="83" fontSize="12" fontWeight="700" fill={color} textAnchor="end" transform="rotate(180 58 77)">
        {card.rank}
      </text>
      <text x="58" y="72" fontSize="11" fill={color} textAnchor="end" transform="rotate(180 58 66)">
        {glyph}
      </text>
      <text x="32" y="55" fontSize="30" fill={color} textAnchor="middle">
        {glyph}
      </text>
    </svg>
  );
}

/** The card back — a self-drawn lattice pattern in the house gold, no external asset. */
export function CardBackFace() {
  return (
    <svg viewBox="0 0 64 90" className="card-face-svg" role="img" aria-hidden="true">
      <rect x="1" y="1" width="62" height="88" rx="7" fill="#0c2a1d" stroke="#b8860b" strokeWidth="1.5" />
      <rect x="6" y="6" width="52" height="78" rx="4" fill="none" stroke="#d8a20a" strokeWidth="1" opacity="0.55" />
      <g stroke="#d8a20a" strokeWidth="0.75" opacity="0.4">
        {Array.from({ length: 6 }, (_, row) =>
          Array.from({ length: 4 }, (_, col) => (
            <path
              key={`${row}-${col}`}
              d={`M${10 + col * 13} ${10 + row * 13} l6.5 6.5 l-6.5 6.5 l-6.5 -6.5 z`}
            />
          )),
        )}
      </g>
      <circle cx="32" cy="45" r="10" fill="none" stroke="#ffd658" strokeWidth="1.25" opacity="0.8" />
      <text x="32" y="50" fontSize="11" fill="#ffd658" textAnchor="middle" fontFamily="'Noto Serif KR', serif" fontWeight="700">
        GC
      </text>
    </svg>
  );
}
