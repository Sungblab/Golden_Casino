import { describe, expect, it } from "vitest";
import type { Card } from "@golden/contracts";
import { buildHoldemPots, comparePokerHands, evaluateBestHoldemHand } from "./holdem.js";

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
      { amount: 300, eligibleUserIds: ["a", "b"] },
      { amount: 300, eligibleUserIds: ["b"] },
    ]);
  });
});
