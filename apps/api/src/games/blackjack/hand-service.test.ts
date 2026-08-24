import { describe, expect, it, vi } from "vitest";

vi.mock("../../database/pool.js", () => ({ pool: {} }));

import { buildBlackjackSettlementEntries } from "./hand-service.js";

const accounts = { room: "room", user: "user", house: "house" };

describe("blackjack ledger settlement entries", () => {
  it.each([
    ["loss", 1_000, 0, { room: -1_000, house: 1_000 }],
    ["late surrender", 1_000, 500, { room: -1_000, user: 500, house: 500 }],
    ["push", 1_000, 1_000, { room: -1_000, user: 1_000 }],
    ["win", 1_000, 2_000, { room: -1_000, user: 2_000, house: -1_000 }],
    ["blackjack", 1_000, 2_500, { room: -1_000, user: 2_500, house: -1_500 }],
  ])("balances a %s", (_label, stake, payout, expected) => {
    const entries = buildBlackjackSettlementEntries(accounts, stake as number, payout as number);
    expect(Object.fromEntries(entries.map((entry) => [entry.accountId, entry.amountMinor]))).toEqual(expected);
    expect(entries.reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(0);
  });
});
