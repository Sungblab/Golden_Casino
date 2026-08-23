import { buildDerivedRoads, layoutDerivedRoad } from "@golden/game-core/derived-roads";
import type { RoundHistoryEntry } from "@golden/contracts";

const ROAD_META = {
  bigEye: { id: "bigEyeRoad", label: "빅아이", rows: 6 },
  small: { id: "smallRoad", label: "스몰", rows: 3 },
  cockroach: { id: "cockroachRoad", label: "코크로치", rows: 3 },
} as const;

/**
 * Big Eye / Small / Cockroach road maps — the derived scoreboards casino players read
 * alongside the Big Road to spot pattern repetition (see @golden/game-core/derived-roads).
 */
export function DerivedRoads({ history }: { history: RoundHistoryEntry[] }) {
  const roads = buildDerivedRoads(history);
  return (
    <div className="derived-roads">
      {(Object.keys(ROAD_META) as Array<keyof typeof ROAD_META>).map((key) => {
        const meta = ROAD_META[key];
        const columns = layoutDerivedRoad(roads[key], meta.rows);
        return (
          <div key={key} id={meta.id} className={`derived-road derived-road-${key}`}>
            <span className="derived-road-label">{meta.label}</span>
            <div className="derived-road-grid">
              {columns.length === 0 && <span className="derived-road-empty" aria-hidden="true" />}
              {columns.map((column, columnIndex) => (
                <div className="derived-road-column" key={columnIndex}>
                  {column.map((cell, rowIndex) => (
                    <span key={rowIndex} className={`derived-road-cell ${cell.outcome}`} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
