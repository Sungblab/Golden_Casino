import { describe, expect, it } from "vitest";
import type { Card } from "@golden/contracts";
import { handScore, payoutMultiplierHundredths, playBaccaratRound, shouldBankerDraw } from "./baccarat.js";
import { Shoe } from "./shoe.js";

describe("baccarat rules", () => {
  it("scores face cards as zero and keeps the last digit", () => {
    expect(handScore([{ rank: "K", suit: "S" }, { rank: "7", suit: "H" }, { rank: "8", suit: "D" }])).toBe(5);
  });

  it("applies the banker third-card table", () => {
    expect(shouldBankerDraw(3, { rank: "8", suit: "S" })).toBe(false);
    expect(shouldBankerDraw(4, { rank: "5", suit: "S" })).toBe(true);
    expect(shouldBankerDraw(6, { rank: "7", suit: "S" })).toBe(true);
  });

  it("stops on a natural", () => {
    const drawOrder: Card[] = [
      { rank: "10", suit: "C" },
      { rank: "8", suit: "D" },
      { rank: "K", suit: "H" },
      { rank: "9", suit: "S" },
    ];
    const result = playBaccaratRound(new Shoe(1, drawOrder));
    expect(result.playerCards).toHaveLength(2);
    expect(result.bankerCards).toHaveLength(2);
    expect(result.result).toBe("player");
  });

  it("uses a 5 percent banker commission", () => {
    const result = { playerCards: [], bankerCards: [], playerScore: 4, bankerScore: 7, result: "banker" as const, playerPair: false, bankerPair: false };
    expect(payoutMultiplierHundredths("banker", result)).toBe(195);
  });

  it("pushes player and banker bets on a tie", () => {
    const result = { playerCards: [], bankerCards: [], playerScore: 6, bankerScore: 6, result: "tie" as const, playerPair: false, bankerPair: false };
    expect(payoutMultiplierHundredths("player", result)).toBe(100);
    expect(payoutMultiplierHundredths("banker", result)).toBe(100);
    expect(payoutMultiplierHundredths("tie", result)).toBe(900);
  });
});
