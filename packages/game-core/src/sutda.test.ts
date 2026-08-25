import { describe, expect, it } from "vitest";
import { createSutdaDeck, evaluateSutdaHand, resolveSutdaWinners } from "./sutda.js";

const card = (month: number, kind: "hikari" | "tanzaku" | "tane" | "kasu") => ({ id: `${month}-${kind}`, month, kind });

describe("Sutda", () => {
  it("uses the traditional twenty-card deck", () => expect(createSutdaDeck()).toHaveLength(20));
  it("orders 38 gwangddang above 18 gwangddang and jangddang", () => {
    expect(evaluateSutdaHand([card(3, "hikari"), card(8, "hikari")]).rank).toBeGreaterThan(evaluateSutdaHand([card(1, "hikari"), card(8, "hikari")]).rank);
    expect(evaluateSutdaHand([card(1, "hikari"), card(8, "hikari")]).rank).toBeGreaterThan(evaluateSutdaHand([card(10, "tanzaku"), card(10, "tane")]).rank);
  });
  it("recognises the named low hands and end count", () => {
    expect(evaluateSutdaHand([card(1, "tanzaku"), card(2, "tane")]).label).toBe("알리");
    expect(evaluateSutdaHand([card(4, "tanzaku"), card(6, "tane")]).label).toBe("세륙");
    expect(evaluateSutdaHand([card(5, "tanzaku"), card(4, "tane")]).label).toBe("갑오");
  });
  it("lets an ambassador catch an 18 gwangddang", () => {
    const result = resolveSutdaWinners([{ userId: "gwang", cards: [card(1, "hikari"), card(8, "hikari")] }, { userId: "amb", cards: [card(4, "tane"), card(7, "tane")] }]);
    expect(result.winnerIds).toEqual(["amb"]);
  });
});
