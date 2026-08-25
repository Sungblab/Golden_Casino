import type { Card } from "@golden/contracts";

export type PokerHandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_of_a_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_of_a_kind"
  | "straight_flush";

export interface PokerHandRank {
  category: PokerHandCategory;
  categoryValue: number;
  kickers: number[];
  cards: Card[];
}

export interface HoldemContribution {
  userId: string;
  amount: number;
  folded: boolean;
}

export interface HoldemPot {
  amount: number;
  eligibleUserIds: string[];
}

function rankValue(card: Card): number {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
}

function combinations<T>(items: T[], choose: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]) => {
    if (selected.length === choose) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= items.length - (choose - selected.length); index += 1) {
      selected.push(items[index]!);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function straightHigh(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5);
    if (window.every((value, offset) => value === window[0]! - offset)) return window[0]!;
  }
  return null;
}

export function evaluateFiveCardHand(cards: Card[]): PokerHandRank {
  if (cards.length !== 5) throw new Error("Poker evaluation requires exactly five cards");
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const straight = straightHigh(values);

  let category: PokerHandCategory;
  let categoryValue: number;
  let kickers: number[];
  if (flush && straight) [category, categoryValue, kickers] = ["straight_flush", 8, [straight]];
  else if (groups[0]![1] === 4) [category, categoryValue, kickers] = ["four_of_a_kind", 7, [groups[0]![0], groups[1]![0]]];
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) [category, categoryValue, kickers] = ["full_house", 6, [groups[0]![0], groups[1]![0]]];
  else if (flush) [category, categoryValue, kickers] = ["flush", 5, values];
  else if (straight) [category, categoryValue, kickers] = ["straight", 4, [straight]];
  else if (groups[0]![1] === 3) [category, categoryValue, kickers] = ["three_of_a_kind", 3, [groups[0]![0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)]];
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value).sort((a, b) => b - a);
    const kicker = groups.find(([, count]) => count === 1)![0];
    [category, categoryValue, kickers] = ["two_pair", 2, [...pairs, kicker]];
  } else if (groups[0]![1] === 2) {
    [category, categoryValue, kickers] = ["pair", 1, [groups[0]![0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)]];
  } else [category, categoryValue, kickers] = ["high_card", 0, values];
  return { category, categoryValue, kickers, cards: [...cards] };
}

export function comparePokerHands(left: PokerHandRank, right: PokerHandRank): number {
  if (left.categoryValue !== right.categoryValue) return left.categoryValue - right.categoryValue;
  const length = Math.max(left.kickers.length, right.kickers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.kickers[index] ?? 0) - (right.kickers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function evaluateBestHoldemHand(cards: Card[]): PokerHandRank {
  if (cards.length < 5 || cards.length > 7) throw new Error("Hold'em evaluation requires five to seven cards");
  return combinations(cards, 5).map(evaluateFiveCardHand).reduce((best, candidate) => comparePokerHands(candidate, best) > 0 ? candidate : best);
}

/** Splits committed chips into a main pot and deterministic side pots. */
export function buildHoldemPots(contributions: HoldemContribution[]): HoldemPot[] {
  if (contributions.some((entry) => !Number.isInteger(entry.amount) || entry.amount < 0)) throw new Error("Invalid Hold'em contribution");
  const levels = [...new Set(contributions.filter((entry) => entry.amount > 0).map((entry) => entry.amount))].sort((a, b) => a - b);
  const pots: HoldemPot[] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = contributions.filter((entry) => entry.amount >= level);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) pots.push({ amount, eligibleUserIds: contributors.filter((entry) => !entry.folded).map((entry) => entry.userId) });
    previous = level;
  }
  return pots;
}
