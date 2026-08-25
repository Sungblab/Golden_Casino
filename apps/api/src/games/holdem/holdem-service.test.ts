import { describe, expect, it } from "vitest";
import { COIN_SCALE } from "@golden/contracts";
import { rakeFor } from "./holdem-service.js";

describe("rakeFor", () => {
  it("takes 5% of a small pot", () => {
    expect(rakeFor(1000, 1000 * COIN_SCALE)).toBe(50);
  });

  it("rounds down to the nearest minor unit", () => {
    expect(rakeFor(999, 1000 * COIN_SCALE)).toBe(49);
  });

  it("caps at three coins even on a huge pot", () => {
    expect(rakeFor(1_000_000, 1000 * COIN_SCALE)).toBe(3 * COIN_SCALE);
  });

  it("never rakes more than the table's own max-bet-derived cap", () => {
    // A 1-coin-max-bet table's cap is 1 coin, not the usual 3-coin cap.
    expect(rakeFor(1_000_000, 1 * COIN_SCALE)).toBe(1 * COIN_SCALE);
  });

  it("takes nothing from an empty pot", () => {
    expect(rakeFor(0, 1000 * COIN_SCALE)).toBe(0);
  });
});
