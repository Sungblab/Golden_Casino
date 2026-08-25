import type { PokerHandCategory, PokerHandRank } from "./holdem.js";

/**
 * Casino Hold'em (a.k.a. Caribbean Hold'em) — a fixed-rule table game, not real heads-up NLHE.
 * The player posts an Ante (+ optional AA Bonus side bet), sees hole cards + flop, then either
 * Calls (2x Ante) or Folds. Turn/river and the dealer's hand are only revealed after a Call.
 * The dealer needs at least a pair of 4s to "qualify" the hand at all.
 */

/** Call bet paytable — pays only when the dealer qualifies and the player's hand wins. */
const CALL_MULTIPLIER: Record<PokerHandCategory, number> = {
  high_card: 1,
  pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 7,
  four_of_a_kind: 20,
  straight_flush: 50,
};

/** AA Bonus paytable — settles on the player's own final hand alone, independent of the dealer.
 * Anything below a pair of 4s (including a lesser pair, or high card) doesn't qualify at all. */
const BONUS_MULTIPLIER: Record<PokerHandCategory, number> = {
  high_card: 0,
  pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 7,
  full_house: 15,
  four_of_a_kind: 50,
  straight_flush: 100,
};

const ROYAL_CALL_MULTIPLIER = 100;
const ROYAL_BONUS_MULTIPLIER = 200;
const BONUS_MIN_PAIR_RANK = 4;

/** A straight_flush whose kickers peak at Ace (14) is the top five: 10-J-Q-K-A of one suit. */
export function isRoyalFlush(hand: PokerHandRank): boolean {
  return hand.category === "straight_flush" && hand.kickers[0] === 14;
}

/** Dealer needs a pair of 4s or better to qualify; anything below that (high card, or a pair of
 * 2s/3s) means the hand doesn't play out — the Ante still pays, the Call just pushes. */
export function dealerQualifies(hand: PokerHandRank): boolean {
  if (hand.categoryValue > 1) return true;
  if (hand.category !== "pair") return false;
  return (hand.kickers[0] ?? 0) >= BONUS_MIN_PAIR_RANK;
}

export function casinoHoldemCallMultiplier(hand: PokerHandRank): number {
  return isRoyalFlush(hand) ? ROYAL_CALL_MULTIPLIER : CALL_MULTIPLIER[hand.category];
}

/** 0 means the bonus doesn't qualify (below a pair of 4s) — caller loses the bonus stake. */
export function casinoHoldemBonusMultiplier(hand: PokerHandRank): number {
  if (isRoyalFlush(hand)) return ROYAL_BONUS_MULTIPLIER;
  if (hand.category === "pair" && (hand.kickers[0] ?? 0) < BONUS_MIN_PAIR_RANK) return 0;
  return BONUS_MULTIPLIER[hand.category];
}
