import type { Card } from "@golden/contracts";

export interface HandValue {
  /** Best total ≤21 if possible (aces counted as 11 where it doesn't bust), otherwise the hard total. */
  total: number;
  /** True if an ace is currently counted as 11 (a "soft" hand, e.g. A+6 = soft 17). */
  soft: boolean;
}

function cardPoints(card: Card): number {
  if (card.rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

/** Standard blackjack hand valuation: aces count as 11 unless that would bust the hand. */
export function handValue(cards: Card[]): HandValue {
  let total = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  let aces = cards.filter((card) => card.rank === "A").length;
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  soft = aces > 0;
  return { total, soft };
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}

/** A natural blackjack is exactly 2 cards totaling 21 (only possible as the opening deal). */
export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

/** Dealer draws to 17+, standing on soft 17 (the common, simpler S17 rule). */
export function dealerShouldHit(cards: Card[]): boolean {
  return handValue(cards).total < 17;
}

export type BlackjackHandStatus = "playing" | "stand" | "bust" | "blackjack" | "doubled";
export type BlackjackOutcome = "win" | "lose" | "push" | "blackjack";

/**
 * Settles one player hand against the finished dealer hand.
 * A natural blackjack pays 3:2 unless the dealer also has one (push). A dealer bust pays
 * every hand that didn't itself bust. Otherwise it's the higher total, ties push.
 */
export function settleHand(playerCards: Card[], playerStatus: BlackjackHandStatus, dealerCards: Card[]): BlackjackOutcome {
  if (playerStatus === "bust") return "lose";
  const playerTotal = handValue(playerCards).total;
  const dealerTotal = handValue(dealerCards).total;
  const playerBlackjack = playerStatus !== "doubled" && isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);

  if (playerBlackjack && dealerBlackjack) return "push";
  if (playerBlackjack) return "blackjack";
  if (dealerBlackjack) return "lose";
  if (dealerTotal > 21) return "win";
  if (playerTotal > dealerTotal) return "win";
  if (playerTotal < dealerTotal) return "lose";
  return "push";
}

/** Total returned to the player (stake included) for a settled hand, in the bet's own unit. */
export function payoutForOutcome(outcome: BlackjackOutcome, bet: number): number {
  if (outcome === "blackjack") return Math.floor(bet * 2.5);
  if (outcome === "win") return bet * 2;
  if (outcome === "push") return bet;
  return 0;
}
