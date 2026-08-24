import type { Card } from "@golden/contracts";

export interface HandValue {
  /** Best total ≤21 if possible (aces counted as 11 where it doesn't bust), otherwise the hard total. */
  total: number;
  /** True if an ace is currently counted as 11 (a "soft" hand, e.g. A+6 = soft 17). */
  soft: boolean;
}

export function cardPoints(card: Card): number {
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

export function canSplitPair(cards: Card[]): boolean {
  return cards.length === 2 && cardPoints(cards[0]!) === cardPoints(cards[1]!);
}

export type BlackjackHandStatus = "playing" | "stand" | "bust" | "blackjack" | "doubled" | "surrendered";
export type BlackjackOutcome = "win" | "lose" | "push" | "blackjack" | "surrender";

export interface BlackjackSettlementOptions {
  /** A 21 made after a split is a normal 21, never a 3:2 natural blackjack. */
  fromSplit?: boolean;
}

/**
 * Settles one player hand against the finished dealer hand.
 * A natural blackjack pays 3:2 unless the dealer also has one (push). A dealer bust pays
 * every hand that didn't itself bust. Otherwise it's the higher total, ties push.
 */
export function settleHand(
  playerCards: Card[],
  playerStatus: BlackjackHandStatus,
  dealerCards: Card[],
  options: BlackjackSettlementOptions = {},
): BlackjackOutcome {
  if (playerStatus === "surrendered") return "surrender";
  if (playerStatus === "bust") return "lose";
  const playerTotal = handValue(playerCards).total;
  const dealerTotal = handValue(dealerCards).total;
  const playerBlackjack = !options.fromSplit && playerStatus !== "doubled" && isBlackjack(playerCards);
  const dealerBlackjack = isBlackjack(dealerCards);

  if (playerBlackjack && dealerBlackjack) return "push";
  if (playerBlackjack) return "blackjack";
  if (dealerBlackjack) return "lose";
  if (dealerTotal > 21) return "win";
  if (playerTotal > dealerTotal) return "win";
  if (playerTotal < dealerTotal) return "lose";
  return "push";
}

/**
 * Total returned to the player (stake included). `unit` is the smallest public
 * chip unit. Fractional 3:2 and surrender returns are quantized to that unit.
 */
export function payoutForOutcome(outcome: BlackjackOutcome, bet: number, unit = 1): number {
  if (!Number.isInteger(bet) || !Number.isInteger(unit) || unit <= 0 || bet < 0 || bet % unit !== 0) {
    throw new Error("Blackjack bet must be a whole number of settlement units");
  }
  if (outcome === "blackjack") return bet + Math.round((bet * 1.5) / unit) * unit;
  if (outcome === "win") return bet * 2;
  if (outcome === "push") return bet;
  if (outcome === "surrender") return Math.floor(bet / (2 * unit)) * unit;
  return 0;
}


/** Insurance is an independent wager of at most half the main bet and returns stake + 2:1 profit. */
export function insurancePayout(insuranceBet: number, dealerCards: Card[]): number {
  return isBlackjack(dealerCards) ? insuranceBet * 3 : 0;
}
