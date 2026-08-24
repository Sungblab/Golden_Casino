import { describe, expect, it } from "vitest";
import type { Card } from "@golden/contracts";
import { handScore, payoutForBaccaratBet, payoutMultiplierHundredths, playBaccaratRound, shouldBankerDraw } from "./baccarat.js";
import { Shoe } from "./shoe.js";

describe("baccarat rules", () => {
  it("scores face cards as zero and keeps the last digit", () => {
    expect(handScore([{ rank: "K", suit: "S" }, { rank: "7", suit: "H" }, { rank: "8", suit: "D" }])).toBe(5);
  });

  it("applies every row of the banker third-card table", () => {
    const expected: Record<number, number[]> = {
      0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      3: [0, 1, 2, 3, 4, 5, 6, 7, 9],
      4: [2, 3, 4, 5, 6, 7],
      5: [4, 5, 6, 7],
      6: [6, 7],
      7: [],
    };
    for (let banker = 0; banker <= 7; banker += 1) {
      for (let third = 0; third <= 9; third += 1) {
        const rank = third === 0 ? "10" : String(third) as Card["rank"];
        expect(shouldBankerDraw(banker, { rank, suit: "S" }), `banker ${banker}, third ${third}`).toBe(expected[banker]!.includes(third));
      }
    }
    for (let banker = 0; banker <= 7; banker += 1) expect(shouldBankerDraw(banker)).toBe(banker <= 5);
  });

  it("stops on a natural", () => {
    const actualDealOrder: Card[] = [
      { rank: "10", suit: "C" },
      { rank: "A", suit: "D" },
      { rank: "K", suit: "H" },
      { rank: "8", suit: "S" },
    ];
    const result = playBaccaratRound(new Shoe(1, actualDealOrder.reverse()));
    expect(result.playerCards).toHaveLength(2);
    expect(result.bankerCards).toHaveLength(2);
    expect(result.playerCards.map((entry) => entry.rank)).toEqual(["10", "K"]);
    expect(result.bankerCards.map((entry) => entry.rank)).toEqual(["A", "8"]);
    expect(result.result).toBe("banker");
  });

  it("uses a 5 percent banker commission", () => {
    const result = { playerCards: [], bankerCards: [], playerScore: 4, bankerScore: 7, result: "banker" as const, playerPair: false, bankerPair: false };
    expect(payoutMultiplierHundredths("banker", result)).toBe(195);
    expect(payoutForBaccaratBet("banker", result, 10)).toBe(20);
    expect(payoutForBaccaratBet("banker", result, 11)).toBe(21);
    expect(payoutForBaccaratBet("banker", result, 1_000, 100)).toBe(2_000);
  });

  it("pushes player and banker bets on a tie", () => {
    const result = { playerCards: [], bankerCards: [], playerScore: 6, bankerScore: 6, result: "tie" as const, playerPair: false, bankerPair: false };
    expect(payoutMultiplierHundredths("player", result)).toBe(100);
    expect(payoutMultiplierHundredths("banker", result)).toBe(100);
    expect(payoutMultiplierHundredths("tie", result)).toBe(900);
  });

  it("pays pair side bets independently of the main result", () => {
    const result = { playerCards: [], bankerCards: [], playerScore: 4, bankerScore: 7, result: "banker" as const, playerPair: true, bankerPair: false };
    expect(payoutMultiplierHundredths("player_pair", result)).toBe(1200);
    expect(payoutMultiplierHundredths("banker_pair", result)).toBe(0);
    expect(payoutMultiplierHundredths("player", result)).toBe(0);
  });

  it("uses the complete standard payout table", () => {
    const player = { playerCards: [], bankerCards: [], playerScore: 7, bankerScore: 4, result: "player" as const, playerPair: false, bankerPair: false };
    const banker = { ...player, playerScore: 4, bankerScore: 7, result: "banker" as const };
    const tie = { ...player, playerScore: 6, bankerScore: 6, result: "tie" as const };
    expect([
      payoutMultiplierHundredths("player", player),
      payoutMultiplierHundredths("banker", banker),
      payoutMultiplierHundredths("tie", tie),
      payoutMultiplierHundredths("player", tie),
      payoutMultiplierHundredths("banker", tie),
    ]).toEqual([200, 195, 900, 100, 100]);
  });
});
