import { describe, expect, it } from "vitest";
import type { Card } from "@golden/contracts";
import { evaluateBestHoldemHand } from "./holdem.js";
import { casinoHoldemBonusMultiplier, casinoHoldemCallMultiplier, dealerQualifies, isRoyalFlush } from "./casino-holdem.js";

function cards(spec: string): Card[] {
  return spec.split(" ").map((token) => ({ rank: token.slice(0, -1) as Card["rank"], suit: token.slice(-1) as Card["suit"] }));
}

describe("dealerQualifies", () => {
  it("does not qualify on high card", () => {
    expect(dealerQualifies(evaluateBestHoldemHand(cards("2S 5H 9D JC KH")))).toBe(false);
  });

  it("does not qualify on a pair below 4s", () => {
    expect(dealerQualifies(evaluateBestHoldemHand(cards("3S 3H 9D JC KH")))).toBe(false);
  });

  it("qualifies on a pair of 4s exactly", () => {
    expect(dealerQualifies(evaluateBestHoldemHand(cards("4S 4H 9D JC KH")))).toBe(true);
  });

  it("qualifies on anything above a pair", () => {
    expect(dealerQualifies(evaluateBestHoldemHand(cards("2S 2H 3D 3C KH")))).toBe(true);
  });
});

describe("isRoyalFlush", () => {
  it("recognizes the top straight flush as royal", () => {
    expect(isRoyalFlush(evaluateBestHoldemHand(cards("AS KS QS JS 10S")))).toBe(true);
  });

  it("does not call a lower straight flush royal", () => {
    expect(isRoyalFlush(evaluateBestHoldemHand(cards("9S KS QS JS 10S")))).toBe(false);
  });
});

describe("casinoHoldemCallMultiplier", () => {
  it("pays a royal flush at 100:1, above the plain straight-flush rate", () => {
    const royal = evaluateBestHoldemHand(cards("AS KS QS JS 10S"));
    expect(casinoHoldemCallMultiplier(royal)).toBe(100);
  });

  it("pays a full house at 7:1", () => {
    const fullHouse = evaluateBestHoldemHand(cards("5S 5H 5D 9C 9H"));
    expect(casinoHoldemCallMultiplier(fullHouse)).toBe(7);
  });
});

describe("casinoHoldemBonusMultiplier", () => {
  it("loses on a pair below 4s", () => {
    const lowPair = evaluateBestHoldemHand(cards("3S 3H 9D JC KH"));
    expect(casinoHoldemBonusMultiplier(lowPair)).toBe(0);
  });

  it("pays even money on a pair of 4s or better", () => {
    const qualifyingPair = evaluateBestHoldemHand(cards("4S 4H 9D JC KH"));
    expect(casinoHoldemBonusMultiplier(qualifyingPair)).toBe(1);
  });

  it("pays a royal flush at 200:1", () => {
    const royal = evaluateBestHoldemHand(cards("AS KS QS JS 10S"));
    expect(casinoHoldemBonusMultiplier(royal)).toBe(200);
  });
});
