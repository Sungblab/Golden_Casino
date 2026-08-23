import type { RoundHistoryEntry } from "@golden/contracts";

export interface BigRoadCell {
  outcome: "player" | "banker";
  ties: number;
  playerPair: boolean;
  bankerPair: boolean;
}

export interface BigRoadResult {
  columns: BigRoadCell[][];
  /** Ties that occurred before the first Player/Banker result, tracked separately. */
  leadingTies: number;
}

/**
 * Converts a chronological result history into a casino-style Big Road grid.
 * - Consecutive identical outcomes (P/P or B/B) stack downward, up to `maxRows`.
 * - Once a column exceeds `maxRows`, the streak continues as a new column ("dragon tail" simplification).
 * - A Tie does not start a new column; it is tallied onto the previous P/B cell.
 * - Ties before the first P/B result are counted separately via `leadingTies`.
 * - Pair side-bets are recorded on the cell created by that round (a pair on a tie round is dropped,
 *   matching how the reference road map only tracks pairs on Player/Banker-deciding rounds).
 */
export function buildBigRoad(history: RoundHistoryEntry[], maxRows = 6): BigRoadResult {
  const columns: BigRoadCell[][] = [];
  let leadingTies = 0;
  let lastOutcome: "player" | "banker" | null = null;

  for (const entry of history) {
    if (entry.result === "tie") {
      if (!lastOutcome) {
        leadingTies += 1;
        continue;
      }
      const column = columns[columns.length - 1]!;
      column[column.length - 1]!.ties += 1;
      continue;
    }

    const cell: BigRoadCell = { outcome: entry.result, ties: 0, playerPair: entry.playerPair, bankerPair: entry.bankerPair };

    if (entry.result === lastOutcome) {
      const column = columns[columns.length - 1]!;
      if (column.length < maxRows) {
        column.push(cell);
      } else {
        columns.push([cell]);
      }
    } else {
      columns.push([cell]);
      lastOutcome = entry.result;
    }
  }

  return { columns, leadingTies };
}

export interface RoadTally {
  player: number;
  banker: number;
  tie: number;
  playerPct: number;
  bankerPct: number;
  tiePct: number;
}

/** Simple win-rate tally used by the road map's stats strip. */
export function tallyResults(history: RoundHistoryEntry[]): RoadTally {
  const player = history.filter((entry) => entry.result === "player").length;
  const banker = history.filter((entry) => entry.result === "banker").length;
  const tie = history.filter((entry) => entry.result === "tie").length;
  const total = player + banker + tie || 1;
  return {
    player,
    banker,
    tie,
    playerPct: Math.round((player / total) * 100),
    bankerPct: Math.round((banker / total) * 100),
    tiePct: Math.round((tie / total) * 100),
  };
}
