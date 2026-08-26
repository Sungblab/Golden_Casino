import { CARD_BACK_URL } from "./CardFace";

/**
 * The table's dealing shoe: a stack of card backs in a dark acrylic wedge,
 * sitting where a live table keeps it. `data-deck-shoe` is what
 * lib/shoeFlight.ts looks for — every PlayingCard dealt inside the same
 * `.ot-felt` launches from this element's on-screen position.
 *
 * Decorative only (the remaining-cards count also lives in the GameShell
 * subtitle), hence aria-hidden.
 */
export function DeckShoe({ remaining }: { remaining?: number }) {
  return (
    <div className="deck-shoe" data-deck-shoe aria-hidden="true">
      <img className="deck-shoe-card lower" src={CARD_BACK_URL} alt="" draggable={false} />
      <img className="deck-shoe-card mid" src={CARD_BACK_URL} alt="" draggable={false} />
      <img className="deck-shoe-card top" src={CARD_BACK_URL} alt="" draggable={false} />
      {typeof remaining === "number" && <b className="deck-shoe-count">{remaining}</b>}
    </div>
  );
}
