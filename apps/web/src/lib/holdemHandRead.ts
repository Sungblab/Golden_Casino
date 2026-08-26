import type { Card } from "@golden/contracts";
import { evaluateBestHoldemHand } from "@golden/game-core/holdem";

/**
 * The viewer's live read of their OWN hand, for the on-felt hand panel.
 *
 * Client-side on purpose, and safe: it only ever combines the viewer's own hole
 * cards (already sent to them) with the public board. It never sees another
 * player's cards, so it cannot leak anything the server hasn't already
 * disclosed — and it means the read updates the instant a street opens instead
 * of waiting for the server's showdown reveal.
 */

export const HOLDEM_HAND_LABEL: Record<string, string> = {
  high_card: "하이카드",
  pair: "원페어",
  two_pair: "투페어",
  three_of_a_kind: "트리플",
  straight: "스트레이트",
  flush: "플러시",
  full_house: "풀하우스",
  four_of_a_kind: "포카드",
  straight_flush: "스트레이트 플러시",
};

const RANK_LABEL: Record<Card["rank"], string> = {
  A: "A", K: "K", Q: "Q", J: "J", "10": "10",
  "9": "9", "8": "8", "7": "7", "6": "6", "5": "5", "4": "4", "3": "3", "2": "2",
};

export interface HoldemHandRead {
  /** "투페어" — or a pre-flop hint ("포켓 페어", "A 하이") when the board is too short to evaluate. */
  label: string;
  /** Short supporting line: which ranks make it, or the pre-flop holding. */
  detail: string;
  /** Identity keys ("Ks") of the five cards forming the hand — empty pre-flop. */
  usedKeys: Set<string>;
  /** False while this is only a pre-flop read, so the UI can present it as a hint. */
  evaluated: boolean;
}

/** Stable identity for a card, used to match evaluated cards back to rendered ones. */
export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/**
 * Royal flush isn't a category in game-core (it's the ace-high straight flush),
 * so name it here where it's a label rather than a ranking concern.
 */
function isRoyal(cards: Card[]): boolean {
  const ranks = new Set(cards.map((card) => card.rank));
  return ["A", "K", "Q", "J", "10"].every((rank) => ranks.has(rank as Card["rank"]));
}

/** Ranks that appear `count` times among the hand's five cards, strongest first. */
function ranksAppearing(cards: Card[], count: number): Card["rank"][] {
  const tally = new Map<Card["rank"], number>();
  for (const card of cards) tally.set(card.rank, (tally.get(card.rank) ?? 0) + 1);
  const order: Card["rank"][] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
  return order.filter((rank) => tally.get(rank) === count);
}

function detailFor(category: string, cards: Card[]): string {
  const pairs = ranksAppearing(cards, 2).map((rank) => RANK_LABEL[rank]);
  const trips = ranksAppearing(cards, 3).map((rank) => RANK_LABEL[rank]);
  const quads = ranksAppearing(cards, 4).map((rank) => RANK_LABEL[rank]);
  const highRank = [...cards].sort((a, b) => rankOrder(b.rank) - rankOrder(a.rank))[0]!.rank;
  const high = RANK_LABEL[highRank];
  switch (category) {
    case "pair": return `${pairs[0]} 페어`;
    case "two_pair": return `${pairs[0]}와 ${pairs[1]}`;
    case "three_of_a_kind": return `${trips[0]} 트리플`;
    case "four_of_a_kind": return `${quads[0]} 포카드`;
    case "full_house": return `${trips[0]} + ${pairs[0]}`;
    case "flush": return `${high} 하이 플러시`;
    case "straight": return `${high} 하이 스트레이트`;
    case "straight_flush": return isRoyal(cards) ? "10부터 A까지" : `${high} 하이`;
    // Not "A 하이카드" — the label already says 하이카드, so repeating it here
    // read as a stutter ("하이카드 / A 하이카드") in the panel.
    default: return `${high} 하이`;
  }
}

function rankOrder(rank: Card["rank"]): number {
  return ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"].indexOf(rank);
}

/**
 * Returns null only when there's nothing to read at all (no hole cards, or the
 * viewer has folded) — otherwise there is always something to show, including
 * pre-flop where the board can't yet make a five-card hand.
 */
export function readHoldemHand(holeCards: Card[] | null, board: Card[]): HoldemHandRead | null {
  if (!holeCards || holeCards.length < 2) return null;
  const known = [...holeCards, ...board];
  if (known.length < 5) {
    // Pre-flop: no five-card hand exists yet, but the holding itself is worth
    // showing — an empty panel here reads as "the feature is broken".
    const [first, second] = holeCards as [Card, Card];
    const suited = first.suit === second.suit;
    if (first.rank === second.rank) {
      return { label: "포켓 페어", detail: `${RANK_LABEL[first.rank]} 포켓`, usedKeys: new Set(), evaluated: false };
    }
    const high = rankOrder(first.rank) >= rankOrder(second.rank) ? first : second;
    const low = high === first ? second : first;
    return {
      label: `${RANK_LABEL[high.rank]} 하이`,
      detail: `${RANK_LABEL[high.rank]}${RANK_LABEL[low.rank]}${suited ? " 수딧" : " 오프수트"}`,
      usedKeys: new Set(),
      evaluated: false,
    };
  }
  const best = evaluateBestHoldemHand(known);
  const label = best.category === "straight_flush" && isRoyal(best.cards)
    ? "로열 플러시"
    : HOLDEM_HAND_LABEL[best.category] ?? best.category;
  return {
    label,
    detail: detailFor(best.category, best.cards),
    usedKeys: new Set(best.cards.map(cardKey)),
    evaluated: true,
  };
}
