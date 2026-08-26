import { describe, expect, it } from "vitest";
import type { BaccaratResult } from "./baccarat.js";
import {
  applyLightningBlackjackMultiplier,
  generateLightningCards,
  lightningFee,
  matchingLightningMultiplier,
  payoutForLightningBaccaratBet,
} from "./lightning.js";

const result: BaccaratResult = {
  playerCards: [{ rank: "8", suit: "S" }, { rank: "K", suit: "H" }],
  bankerCards: [{ rank: "4", suit: "C" }, { rank: "3", suit: "D" }],
  playerScore: 8,
  bankerScore: 7,
  result: "player",
  playerPair: false,
  bankerPair: false,
};

describe("lightning games", () => {
  it("creates unique virtual cards", () => {
    const values = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const cards = generateLightningCards(() => values.shift() ?? 0);
    expect(cards).toHaveLength(5);
    expect(new Set(cards.map((entry) => `${entry.card.rank}${entry.card.suit}`)).size).toBe(5);
  });

  it("charges whole-unit fees", () => {
    expect(lightningFee(500, 20, 100)).toBe(100);
    expect(lightningFee(500, 100, 100)).toBe(500);
  });

  it("multiplies profit for every matching winning card", () => {
    const lightning = [
      { card: result.playerCards[0]!, multiplier: 2 as const },
      { card: result.playerCards[1]!, multiplier: 8 as const },
    ];
    expect(matchingLightningMultiplier("player", result, lightning)).toBe(16);
    expect(payoutForLightningBaccaratBet("player", result, lightning, 100)).toBe(1700);
  });

  it("uses Lightning Baccarat base payouts instead of standard Baccarat payouts", () => {
    const tie: BaccaratResult = { ...result, result: "tie", bankerScore: 8 };
    const pair: BaccaratResult = { ...result, playerPair: true };
    expect(payoutForLightningBaccaratBet("tie", tie, [], 100)).toBe(600);
    expect(payoutForLightningBaccaratBet("player_pair", pair, [], 100)).toBe(1000);
    expect(payoutForLightningBaccaratBet("banker", { ...result, result: "banker" }, [{ card: result.bankerCards[0]!, multiplier: 8 }], 100)).toBe(895);
  });

  it("applies blackjack lightning multipliers to profit, not returned stake", () => {
    expect(applyLightningBlackjackMultiplier(200, 100, 5)).toBe(600);
    expect(applyLightningBlackjackMultiplier(100, 100, 25)).toBe(100);
  });
});
