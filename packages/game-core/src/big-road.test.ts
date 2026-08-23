import { describe, expect, it } from "vitest";
import type { RoundHistoryEntry, RoundResult } from "@golden/contracts";
import { buildBigRoad, tallyResults } from "./big-road.js";

/** Builds a history entry with no pair side-bets, for tests that don't care about pairs. */
function entry(result: RoundResult, playerPair = false, bankerPair = false): RoundHistoryEntry {
  return { result, playerPair, bankerPair };
}

describe("buildBigRoad", () => {
  it("stacks consecutive identical outcomes into one column", () => {
    const history = [entry("player"), entry("player"), entry("player")];
    const { columns } = buildBigRoad(history);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(3);
    expect(columns[0]!.every((cell) => cell.outcome === "player")).toBe(true);
  });

  it("starts a new column when the outcome changes", () => {
    const history = [entry("player"), entry("banker"), entry("player")];
    const { columns } = buildBigRoad(history);
    expect(columns).toHaveLength(3);
  });

  it("accumulates a tie onto the previous cell instead of a new column", () => {
    const history = [entry("player"), entry("tie"), entry("player")];
    const { columns } = buildBigRoad(history);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(2);
    expect(columns[0]![0]!.ties).toBe(1);
  });

  it("counts ties before any result as leadingTies", () => {
    const history = [entry("tie"), entry("tie"), entry("banker")];
    const { columns, leadingTies } = buildBigRoad(history);
    expect(leadingTies).toBe(2);
    expect(columns).toHaveLength(1);
  });

  it("continues the streak as a new column once maxRows is exceeded", () => {
    const history = [entry("player"), entry("player"), entry("player")];
    const { columns } = buildBigRoad(history, 2);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toHaveLength(2);
    expect(columns[1]).toHaveLength(1);
  });

  it("records the pair flags on the cell created by that round", () => {
    const history = [entry("player", true, false), entry("banker", false, true)];
    const { columns } = buildBigRoad(history);
    expect(columns[0]![0]).toMatchObject({ playerPair: true, bankerPair: false });
    expect(columns[1]![0]).toMatchObject({ playerPair: false, bankerPair: true });
  });
});

describe("tallyResults", () => {
  it("computes rounded percentages that reflect the outcome mix", () => {
    const history = [entry("player"), entry("player"), entry("banker"), entry("tie")];
    const tally = tallyResults(history);
    expect(tally).toEqual({ player: 2, banker: 1, tie: 1, playerPct: 50, bankerPct: 25, tiePct: 25 });
  });

  it("does not divide by zero on an empty history", () => {
    expect(tallyResults([])).toEqual({ player: 0, banker: 0, tie: 0, playerPct: 0, bankerPct: 0, tiePct: 0 });
  });
});
