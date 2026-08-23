import { describe, expect, it } from "vitest";
import type { Card } from "@golden/contracts";
import { dealerShouldHit, handValue, isBlackjack, isBust, payoutForOutcome, settleHand } from "./blackjack.js";

const card = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("handValue", () => {
  it("sums number and face cards at face value", () => {
    expect(handValue([card("9"), card("8")])).toEqual({ total: 17, soft: false });
    expect(handValue([card("K"), card("Q")])).toEqual({ total: 20, soft: false });
  });

  it("counts an ace as 11 when it doesn't bust", () => {
    expect(handValue([card("A"), card("6")])).toEqual({ total: 17, soft: true });
  });

  it("drops an ace to 1 once counting it as 11 would bust", () => {
    expect(handValue([card("A"), card("6"), card("9")])).toEqual({ total: 16, soft: false });
  });

  it("handles two aces (soft 12)", () => {
    expect(handValue([card("A"), card("A")])).toEqual({ total: 12, soft: true });
  });
});

describe("isBust / isBlackjack", () => {
  it("flags totals over 21 as bust", () => {
    expect(isBust([card("K"), card("Q"), card("5")])).toBe(true);
    expect(isBust([card("K"), card("Q")])).toBe(false);
  });

  it("recognizes a natural 21 as blackjack only on the first two cards", () => {
    expect(isBlackjack([card("A"), card("K")])).toBe(true);
    expect(isBlackjack([card("7"), card("7"), card("7")])).toBe(false);
  });
});

describe("dealerShouldHit", () => {
  it("hits below 17 and stands on 17+, including soft 17", () => {
    expect(dealerShouldHit([card("9"), card("6")])).toBe(true);
    expect(dealerShouldHit([card("A"), card("6")])).toBe(false);
    expect(dealerShouldHit([card("10"), card("7")])).toBe(false);
  });
});

describe("settleHand", () => {
  it("pays a player blackjack unless the dealer also has one", () => {
    expect(settleHand([card("A"), card("K")], "blackjack", [card("9"), card("8")])).toBe("blackjack");
    expect(settleHand([card("A"), card("K")], "blackjack", [card("A"), card("Q")])).toBe("push");
  });

  it("loses automatically on player bust regardless of the dealer's hand", () => {
    expect(settleHand([card("K"), card("Q"), card("5")], "bust", [card("2"), card("3")])).toBe("lose");
  });

  it("pays every standing hand when the dealer busts", () => {
    expect(settleHand([card("10"), card("6")], "stand", [card("K"), card("Q"), card("5")])).toBe("win");
  });

  it("compares totals when neither side busts or has blackjack", () => {
    expect(settleHand([card("10"), card("9")], "stand", [card("10"), card("7")])).toBe("win");
    expect(settleHand([card("10"), card("7")], "stand", [card("10"), card("9")])).toBe("lose");
    expect(settleHand([card("10"), card("8")], "stand", [card("10"), card("8")])).toBe("push");
  });
});

describe("payoutForOutcome", () => {
  it("pays 3:2 on blackjack, 1:1 on a win, stake back on push, nothing on a loss", () => {
    expect(payoutForOutcome("blackjack", 10)).toBe(25);
    expect(payoutForOutcome("win", 10)).toBe(20);
    expect(payoutForOutcome("push", 10)).toBe(10);
    expect(payoutForOutcome("lose", 10)).toBe(0);
  });
});
