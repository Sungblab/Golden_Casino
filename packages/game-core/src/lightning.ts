import type { BaccaratBetChoice, Card } from "@golden/contracts";
import type { BaccaratResult } from "./baccarat.js";
import { payoutForBaccaratBet } from "./baccarat.js";

export interface LightningCard {
  card: Card;
  multiplier: 2 | 3 | 4 | 5 | 8;
}

export type RandomInt = (maximumExclusive: number) => number;

/** Browser- and Node-compatible unbiased integer backed by Web Crypto. */
export function secureRandomInt(maximumExclusive: number): number {
  if (!Number.isInteger(maximumExclusive) || maximumExclusive <= 0) throw new Error("maximumExclusive must be positive");
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error("Secure random generator is unavailable");
  const range = 0x1_0000_0000;
  const limit = range - (range % maximumExclusive);
  const value = new Uint32Array(1);
  do cryptoApi.getRandomValues(value); while (value[0]! >= limit);
  return value[0]! % maximumExclusive;
}

const ranks: Card["rank"][] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits: Card["suit"][] = ["S", "H", "D", "C"];
const multipliers: LightningCard["multiplier"][] = [2, 3, 4, 5, 8];

/**
 * Evolution publishes the possible values, but not the RNG weight table. Keep the
 * distribution explicit and tunable instead of accidentally making every value equally
 * likely (which makes the game player-positive once the 20% fee is included).
 */
const MULTIPLIER_WEIGHTS = [25, 25, 20, 20, 10] as const;

function weightedIndex(rng: RandomInt, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let ticket = rng(total);
  for (let index = 0; index < weights.length; index += 1) {
    ticket -= weights[index]!;
    if (ticket < 0) return index;
  }
  return weights.length - 1;
}

export function cardIdentity(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** Generates 1-5 unique virtual cards and their independent 2x-8x multipliers. */
export function generateLightningCards(rng: RandomInt = secureRandomInt): LightningCard[] {
  const count = rng(5) + 1;
  const deck: Card[] = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  const selected: LightningCard[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = rng(deck.length);
    const [card] = deck.splice(target, 1);
    selected.push({ card: card!, multiplier: multipliers[weightedIndex(rng, MULTIPLIER_WEIGHTS)]! });
  }
  return selected;
}

export function lightningFee(stake: number, percent: 0 | 20 | 100, unit = 1): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Lightning stake must be a whole number of settlement units");
  }
  return Math.round((stake * percent) / 100 / unit) * unit;
}

function winningCards(choice: BaccaratBetChoice, result: BaccaratResult): Card[] {
  if (choice === "player" && result.result === "player") return result.playerCards;
  if (choice === "banker" && result.result === "banker") return result.bankerCards;
  if (choice === "tie" && result.result === "tie") return [...result.playerCards, ...result.bankerCards];
  if (choice === "player_pair" && result.playerPair) return result.playerCards.slice(0, 2);
  if (choice === "banker_pair" && result.bankerPair) return result.bankerCards.slice(0, 2);
  if (choice === "player_bonus" && result.result === "player") return result.playerCards;
  if (choice === "banker_bonus" && result.result === "banker") return result.bankerCards;
  return [];
}

export function matchingLightningMultiplier(
  choice: BaccaratBetChoice,
  result: BaccaratResult,
  lightningCards: LightningCard[],
): number {
  const byCard = new Map(lightningCards.map((item) => [cardIdentity(item.card), item.multiplier]));
  return winningCards(choice, result).reduce((product, card) => product * (byCard.get(cardIdentity(card)) ?? 1), 1);
}

/**
 * Returns stake plus the standard Baccarat profit multiplied by every matching
 * Lightning Card. The separately charged 20% fee is never part of the stake.
 */
export function payoutForLightningBaccaratBet(
  choice: BaccaratBetChoice,
  result: BaccaratResult,
  lightningCards: LightningCard[],
  stake: number,
  unit = 1,
): number {
  if (!Number.isInteger(stake) || !Number.isInteger(unit) || unit <= 0 || stake < 0 || stake % unit !== 0) {
    throw new Error("Lightning Baccarat stake must be a whole number of settlement units");
  }
  const stakeUnits = stake / unit;
  // Bonus side bets are enabled in some shared baccarat contracts but are not part of
  // Evolution's Lightning Baccarat layout. Preserve their existing payout semantics if
  // an operator enables them in a Lightning room.
  if (choice === "player_bonus" || choice === "banker_bonus") {
    const baseReturn = payoutForBaccaratBet(choice, result, stake, unit);
    if (baseReturn <= stake) return baseReturn;
    return stake + (baseReturn - stake) * matchingLightningMultiplier(choice, result, lightningCards);
  }
  let baseProfitHundredths: number;
  let returnedStakeHundredths = 100;
  if ((choice === "player" && result.result === "tie") || (choice === "banker" && result.result === "tie")) return stake;
  if (choice === "player" && result.result === "player") baseProfitHundredths = 100;
  else if (choice === "banker" && result.result === "banker") {
    baseProfitHundredths = 100;
    returnedStakeHundredths = 95;
  } else if (choice === "tie" && result.result === "tie") baseProfitHundredths = 500;
  else if (choice === "player_pair" && result.playerPair) baseProfitHundredths = 900;
  else if (choice === "banker_pair" && result.bankerPair) baseProfitHundredths = 900;
  else return 0;
  const multiplier = matchingLightningMultiplier(choice, result, lightningCards);
  const profitUnits = Math.round((stakeUnits * baseProfitHundredths * multiplier) / 100);
  return Math.round((stakeUnits * returnedStakeHundredths) / 100 + profitUnits) * unit;
}

export const LIGHTNING_BLACKJACK_MULTIPLIERS = [2, 5, 8, 10, 15, 20, 25] as const;
export type LightningBlackjackMultiplier = (typeof LIGHTNING_BLACKJACK_MULTIPLIERS)[number];

export function drawLightningBlackjackMultiplier(rng: RandomInt = secureRandomInt): LightningBlackjackMultiplier {
  return LIGHTNING_BLACKJACK_MULTIPLIERS[rng(LIGHTNING_BLACKJACK_MULTIPLIERS.length)]!;
}

/** Applies a saved multiplier to profit only and returns the original stake once. */
export function applyLightningBlackjackMultiplier(baseReturn: number, stake: number, multiplier: number): number {
  if (baseReturn <= stake) return baseReturn;
  return stake + (baseReturn - stake) * multiplier;
}
