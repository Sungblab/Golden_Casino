import type { RoundHistoryEntry } from "@golden/contracts";

export type DerivedRoadMark = "player" | "banker";

export interface DerivedRoads {
  /** Compares each new Big Road column against the one 1 column back ("Big Eye Road"). */
  bigEye: DerivedRoadMark[];
  /** Compares against the column 2 back ("Small Road"). */
  small: DerivedRoadMark[];
  /** Compares against the column 3 back ("Cockroach Road"). */
  cockroach: DerivedRoadMark[];
}

/**
 * Derives the three "eye" road maps that casino players read alongside the Big Road to
 * spot pattern repetition. Ties are excluded (a tie never starts a new Big Road column),
 * then each non-tie result's Big Road coordinate is compared against an earlier column
 * per the standard derived-road rule:
 *   - First row of a column (a new streak start): compare the two preceding columns' depth.
 *     Same depth -> "banker" (steady), different depth -> "player" (choppy).
 *   - Any other row (a streak continuing): if the reference column has a cell in the same
 *     row -> "player", otherwise -> "banker".
 * The three roads only differ in how many columns back they compare (1 / 2 / 3).
 */
export function buildDerivedRoads(history: RoundHistoryEntry[]): DerivedRoads {
  const roads: DerivedRoads = { bigEye: [], small: [], cockroach: [] };
  const nonTie = history.filter((entry) => entry.result !== "tie");
  if (nonTie.length < 2) return roads;

  const coords: Array<{ row: number; col: number }> = [];
  let col = 0;
  let row = 0;
  let lastOutcome: "player" | "banker" | null = null;

  for (const entry of nonTie) {
    const outcome = entry.result as "player" | "banker";
    if (lastOutcome && outcome !== lastOutcome) {
      col += 1;
      row = 0;
    }
    coords.push({ row, col });
    lastOutcome = outcome;
    row += 1;
  }

  const columnDepth = (c: number): number => coords.filter((p) => p.col === c).length;
  const cellExists = (r: number, c: number): boolean => coords.some((p) => p.row === r && p.col === c);

  const derive = (offset: number, r: number, c: number): DerivedRoadMark | null => {
    if (c < offset) return null;
    if (r === 0) {
      if (c < offset + 1) return null;
      return columnDepth(c - offset) === columnDepth(c - offset - 1) ? "banker" : "player";
    }
    return cellExists(r, c - offset) ? "player" : "banker";
  };

  for (let i = 1; i < coords.length; i += 1) {
    const { row: r, col: c } = coords[i]!;
    const bigEye = derive(1, r, c);
    if (bigEye) roads.bigEye.push(bigEye);
    const small = derive(2, r, c);
    if (small) roads.small.push(small);
    const cockroach = derive(3, r, c);
    if (cockroach) roads.cockroach.push(cockroach);
  }

  return roads;
}

export interface DerivedRoadCell {
  outcome: DerivedRoadMark;
}

/** Lays out a derived road's flat mark sequence into Big-Road-style columns for rendering. */
export function layoutDerivedRoad(marks: DerivedRoadMark[], maxRows: number): DerivedRoadCell[][] {
  const columns: DerivedRoadCell[][] = [];
  let lastMark: DerivedRoadMark | null = null;

  for (const mark of marks) {
    if (mark === lastMark) {
      const column = columns[columns.length - 1]!;
      if (column.length < maxRows) {
        column.push({ outcome: mark });
      } else {
        columns.push([{ outcome: mark }]);
      }
    } else {
      columns.push([{ outcome: mark }]);
      lastMark = mark;
    }
  }

  return columns;
}
