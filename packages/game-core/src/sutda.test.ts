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
  it("special hands fall back to their ordinary 끗 total when the catch does not trigger", () => {
    // 암행어사 4+7=11 → 1끗: beats 망통, loses to 2끗 — it must not rank as 망통.
    expect(evaluateSutdaHand([card(4, "tane"), card(7, "tane")]).rank).toBe(1);
    // 멍텅구리 구사 4+9=13 → 3끗.
    expect(evaluateSutdaHand([card(4, "tane"), card(9, "tane")]).rank).toBe(3);
    // 땡잡이 3+7=10 → 망통.
    expect(evaluateSutdaHand([card(3, "hikari"), card(7, "tane")]).rank).toBe(0);
    const idleAmbassador = resolveSutdaWinners([
      { userId: "amb", cards: [card(4, "tane"), card(7, "tane")] },
      { userId: "mang", cards: [card(2, "tanzaku"), card(8, "tane")] },
    ]);
    expect(idleAmbassador.winnerIds).toEqual(["amb"]);
  });
  it("keeps 멍텅구리 구사 as a 3끗 hand when 장땡 blocks the redeal", () => {
    const result = resolveSutdaWinners([
      { userId: "mungu", cards: [card(4, "tane"), card(9, "tane")] },
      { userId: "jang", cards: [card(10, "tanzaku"), card(10, "tane")] },
    ]);
    expect(result.redeal).toBe(false);
    expect(result.winnerIds).toEqual(["jang"]);
  });
});
