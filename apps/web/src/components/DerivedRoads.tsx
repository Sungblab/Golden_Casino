import { useEffect, useMemo, useRef, useState } from "react";
import { buildDerivedRoads, layoutDerivedRoad } from "@golden/game-core/derived-roads";
import type { RoundHistoryEntry, RoundResult } from "@golden/contracts";

const ROAD_META = {
  bigEye: { id: "bigEyeRoad", rows: 6, label: "BIG EYE" },
  small: { id: "smallRoad", rows: 3, label: "SMALL" },
  cockroach: { id: "cockroachRoad", rows: 3, label: "COCKROACH" },
} as const;

const EXPANDED_KEY = "golden.derived-roads.expanded";

// Open by default — user call: the stats should be visible without an extra tap. "0" is the
// only thing that collapses it, so someone who deliberately closes it stays closed next time.
function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Big Eye / Small / Cockroach road maps — the derived scoreboards casino players read
 * alongside the Big Road to spot pattern repetition (see @golden/game-core/derived-roads).
 * Shown expanded by default; the strip still collapses on tap for anyone who wants the
 * felt space back, and remembers that choice.
 */
export function DerivedRoads({ history, prediction }: { history: RoundHistoryEntry[]; prediction?: RoundResult | null }) {
  const [expanded, setExpanded] = useState(readExpanded);
  const roads = useMemo(() => buildDerivedRoads(prediction ? [...history, { result: prediction, playerPair: false, bankerPair: false }] : history), [history, prediction]);
  const settledRoads = useMemo(() => buildDerivedRoads(history), [history]);
  const gridRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousLengthRef = useRef(0);

  useEffect(() => {
    const behavior = previousLengthRef.current > 0 ? "smooth" : "auto";
    Object.values(gridRefs.current).forEach((grid) => grid?.scrollTo({ left: grid.scrollWidth, behavior }));
    previousLengthRef.current = history.length;
  }, [history.length, prediction, expanded]);

  const toggle = () => {
    setExpanded((current) => {
      const next = !current;
      try { window.localStorage.setItem(EXPANDED_KEY, next ? "1" : "0"); } catch { /* per-viewer convenience only */ }
      return next;
    });
  };

  return (
    <div className={`derived-roads ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <button type="button" className="derived-roads-toggle" onClick={toggle} aria-expanded={expanded}>
        {(Object.keys(ROAD_META) as Array<keyof typeof ROAD_META>).map((key) => (
          <span key={key} className={`derived-roads-toggle-item is-${key}`}>
            <i aria-hidden="true" />
            <span className="derived-roads-toggle-label">{ROAD_META[key].label}</span>
            <b>{settledRoads[key].length}</b>
          </span>
        ))}
        <span className="derived-roads-toggle-caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (Object.keys(ROAD_META) as Array<keyof typeof ROAD_META>).map((key) => {
        const meta = ROAD_META[key];
        const columns = layoutDerivedRoad(roads[key], meta.rows);
        const hasPreview = Boolean(prediction && roads[key].length > settledRoads[key].length);
        return (
          <div key={key} id={meta.id} className={`derived-road derived-road-${key}`}>
            <div className="derived-road-grid" ref={(element) => { gridRefs.current[key] = element; }}>
              {columns.length === 0 && <span className="derived-road-empty" aria-hidden="true" />}
              {columns.map((column, columnIndex) => (
                <div className="derived-road-column" key={columnIndex}>
                  {column.map((cell, rowIndex) => <span key={rowIndex} style={{ gridRow: cell.row + 1 }} className={`derived-road-cell ${cell.outcome} ${hasPreview && columnIndex === columns.length - 1 && rowIndex === column.length - 1 ? "road-preview" : ""}`} />)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
