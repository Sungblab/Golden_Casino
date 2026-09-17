import { describe, expect, it } from "vitest";
import type { Card } from "@golden/contracts";
import {
  buildHoldemPots,
  comparePokerHands,
  evaluateBestHoldemHand,
  evaluateFiveCardHand,
  HOLDEM_RANKINGS,
  holdemCategoryTier,
  holdemPreflopTier,
  readHoldemDraws,
} from "./holdem.js";

const cards = (input: string): Card[] => input.split(" ").map((code) => ({
  rank: code.slice(0, -1) as Card["rank"],
  suit: code.slice(-1) as Card["suit"],
}));

describe("holdem evaluator", () => {
  it("finds a wheel straight and a royal straight flush", () => {
    expect(evaluateBestHoldemHand(cards("AS 2D 3C 4H 5S KD QC")).kickers).toEqual([5]);
    expect(evaluateBestHoldemHand(cards("10S JS QS KS AS 2D 3C")).category).toBe("straight_flush");
  });

  it("uses kickers to break equal pairs", () => {
    const aceKicker = evaluateBestHoldemHand(cards("9S 9D AS 7C 4H 2D 3C"));
    const kingKicker = evaluateBestHoldemHand(cards("9H 9C KS 7D 4C 2S 3D"));
    expect(comparePokerHands(aceKicker, kingKicker)).toBeGreaterThan(0);
  });

  it("builds main and side pots excluding folded players from eligibility", () => {
    expect(buildHoldemPots([
      { userId: "a", amount: 100, folded: false },
      { userId: "b", amount: 250, folded: false },
      { userId: "c", amount: 250, folded: true },
    ])).toEqual([
      { amount: 300, eligibleUserIds: ["a", "b"], contributorUserIds: ["a", "b", "c"] },
      { amount: 300, eligibleUserIds: ["b"], contributorUserIds: ["b", "c"] },
    ]);
  });

  it("keeps a pot's contributors even when every one of them folded", () => {
    // "b" raises to 250 with nothing left to call (toCall is 0 on their own bet), then folds
    // anyway — applyAction's fold has no toCall guard, so this is reachable in real play, not
    // just a theoretical input. The top 150 of that raise was never matched by "a", so it has
    // zero eligible winners; settle() needs contributorUserIds to refund it to "b" instead of
    // silently dropping it (which used to unbalance the ledger and crash the hand).
    expect(buildHoldemPots([
      { userId: "a", amount: 100, folded: false },
      { userId: "b", amount: 250, folded: true },
    ])).toEqual([
      { amount: 200, eligibleUserIds: ["a"], contributorUserIds: ["a", "b"] },
      { amount: 150, eligibleUserIds: [], contributorUserIds: ["b"] },
    ]);
  });

  it("ships a ranking table whose examples evaluate to their own row", () => {
    expect(HOLDEM_RANKINGS).toHaveLength(10);
    for (const row of HOLDEM_RANKINGS) {
      const evaluated = evaluateFiveCardHand(row.cards);
      expect(evaluated.category).toBe(row.category === "royal_flush" ? "straight_flush" : row.category);
    }
    // Strongest first.
    const values = HOLDEM_RANKINGS.map((row) => evaluateFiveCardHand(row.cards));
    for (let index = 1; index < values.length; index += 1) expect(comparePokerHands(values[index - 1]!, values[index]!)).toBeGreaterThanOrEqual(0);
  });

  it("grades made hands and starting hands on the same five-step scale", () => {
    expect(holdemCategoryTier("high_card").tier).toBe(1);
    expect(holdemCategoryTier("straight_flush").tier).toBe(5);
    expect(holdemPreflopTier(cards("AS AD") as [Card, Card]).tier).toBe(5);
    expect(holdemPreflopTier(cards("AS KS") as [Card, Card]).tier).toBe(5);
    expect(holdemPreflopTier(cards("7H 2C") as [Card, Card]).tier).toBe(1);
    expect(holdemPreflopTier(cards("8H 7H") as [Card, Card]).tier).toBe(2);
  });

  it("spots flush and straight draws on the flop and turn only", () => {
    const flushDraw = readHoldemDraws(cards("AS KS 3S 9S 2D"));
    expect(flushDraw.flush).toEqual({ suit: "S", have: 4 });
    const openEnded = readHoldemDraws(cards("9S 8D 7C 6H 2D"));
    expect(openEnded.straight?.kind).toBe("open");
    expect(openEnded.straight?.needed).toEqual(["5", "10"]);
    const gutshot = readHoldemDraws(cards("9S 8D 6C 5H 2D"));
    expect(gutshot.straight?.kind).toBe("gutshot");
    expect(gutshot.straight?.needed).toEqual(["7"]);
    // A made straight is not a draw, and the river has nothing left to draw to.
    expect(readHoldemDraws(cards("9S 8D 7C 6H 5D")).straight).toBeNull();
    expect(readHoldemDraws(cards("AS KS 3S 9S 2D 4C 8H")).flush).toBeNull();
    expect(readHoldemDraws(cards("AS KS")).flush).toBeNull();
  });
});
