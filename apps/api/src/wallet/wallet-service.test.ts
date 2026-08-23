import { describe, expect, it } from "vitest";
import { assertBalancedEntries } from "./wallet-service.js";

describe("ledger invariants", () => {
  it("accepts a zero-sum transfer", () => {
    expect(() => assertBalancedEntries([{ accountId: "user", amountMinor: -100 }, { accountId: "escrow", amountMinor: 100 }])).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() => assertBalancedEntries([{ accountId: "user", amountMinor: -100 }, { accountId: "escrow", amountMinor: 90 }])).toThrow(/balance to zero/);
  });

  it("rejects a single-entry balance mutation", () => {
    expect(() => assertBalancedEntries([{ accountId: "user", amountMinor: 100 }])).toThrow(/balance to zero/);
  });
});
