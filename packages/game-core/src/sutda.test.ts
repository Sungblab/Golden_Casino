import { describe, expect, it } from "vitest";
import {
  createSutdaDeck,
  evaluateSutdaHand,
  resolveSutdaWinners,
  SUTDA_RANKINGS,
  SUTDA_SPECIALS,
  sutdaHandStrength,
  sutdaSecondCardOutlook,
  sutdaTierOf,
} from "./sutda.js";

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
  it("never lets an ambassador catch a 38 gwangddang", () => {
    const result = resolveSutdaWinners([{ userId: "gwang", cards: [card(3, "hikari"), card(8, "hikari")] }, { userId: "amb", cards: [card(4, "tane"), card(7, "tane")] }]);
    expect(result.winnerIds).toEqual(["gwang"]);
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
  it("lets 땡잡이 catch a 9땡 that is the best hand on the table", () => {
    const result = resolveSutdaWinners([
      { userId: "catcher", cards: [card(3, "hikari"), card(7, "tane")] },
      { userId: "nine", cards: [card(9, "tanzaku"), card(9, "tane")] },
      { userId: "gabo", cards: [card(4, "tanzaku"), card(5, "tanzaku")] },
    ]);
    expect(result.winnerIds).toEqual(["catcher"]);
  });
  it("does not let 땡잡이 beat a 광땡 just because a lower 땡 is also present", () => {
    const result = resolveSutdaWinners([
      { userId: "catcher", cards: [card(3, "hikari"), card(7, "tane")] },
      { userId: "nine", cards: [card(9, "tanzaku"), card(9, "tane")] },
      { userId: "gwang", cards: [card(1, "hikari"), card(8, "hikari")] },
    ]);
    expect(result.winnerIds).toEqual(["gwang"]);
  });

  describe("reference data", () => {
    it("lists every regular 족보 strongest first with distinct labels", () => {
      const ranks = SUTDA_RANKINGS.map((row) => row.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
      expect(new Set(SUTDA_RANKINGS.map((row) => row.label)).size).toBe(SUTDA_RANKINGS.length);
      expect(SUTDA_RANKINGS[0]!.label).toBe("38광땡");
      expect(SUTDA_RANKINGS.at(-1)!.label).toBe("망통");
      // 3 광땡 rows + 10 땡 + 6 named + 갑오 + 8 끗 + 망통.
      expect(SUTDA_RANKINGS).toHaveLength(29);
    });
    it("draws each row with cards that actually evaluate to that row's label", () => {
      for (const row of SUTDA_RANKINGS) expect(evaluateSutdaHand(row.cards).label).toBe(row.label);
      for (const row of SUTDA_SPECIALS) expect(evaluateSutdaHand(row.cards).label).toBe(row.label);
    });
    it("only uses cards that exist in the deck", () => {
      const ids = new Set(createSutdaDeck().map((c) => c.id));
      for (const row of [...SUTDA_RANKINGS, ...SUTDA_SPECIALS]) for (const c of row.cards) expect(ids.has(c.id)).toBe(true);
    });
  });

  describe("strength", () => {
    it("places 38광땡 above everything and 망통 below everything", () => {
      const top = sutdaHandStrength(evaluateSutdaHand([card(3, "hikari"), card(8, "hikari")]));
      expect(top.percentile).toBe(100);
      expect(top.beats).toBe(top.total);
      expect(top.tier).toBe("gwangddaeng");
      const bottom = sutdaHandStrength(evaluateSutdaHand([card(2, "tanzaku"), card(8, "tane")]));
      expect(bottom.beats).toBe(0);
      expect(bottom.tier).toBe("mangtong");
    });
    it("reports ties without counting the hand itself", () => {
      // 갑오 can be made by several month pairs; the hand's own combination is excluded.
      const gabo = sutdaHandStrength(evaluateSutdaHand([card(4, "tanzaku"), card(5, "tanzaku")]));
      expect(gabo.tier).toBe("gabo");
      expect(gabo.ties).toBeGreaterThan(0);
      expect(gabo.beats + gabo.ties).toBeLessThan(gabo.total);
    });
    it("maps ranks to tiers", () => {
      expect(sutdaTierOf(1000)).toBe("gwangddaeng");
      expect(sutdaTierOf(905)).toBe("ddaeng");
      expect(sutdaTierOf(800)).toBe("named");
      expect(sutdaTierOf(700)).toBe("gabo");
      expect(sutdaTierOf(4)).toBe("kkeut");
      expect(sutdaTierOf(0)).toBe("mangtong");
    });
  });

  describe("second-card outlook", () => {
    it("lists 38광땡 first for a held 3광 and never suggests the held card", () => {
      const three = createSutdaDeck().find((c) => c.month === 3 && c.kind === "hikari")!;
      const outlook = sutdaSecondCardOutlook(three);
      expect(outlook[0]!.label).toBe("38광땡");
      expect(outlook[0]!.cards.map((c) => c.id)).toEqual(["August_Hikari"]);
      expect(outlook.some((entry) => entry.cards.some((c) => c.id === three.id))).toBe(false);
      expect(outlook.reduce((sum, entry) => sum + entry.cards.length, 0)).toBe(19);
    });
  });
});
