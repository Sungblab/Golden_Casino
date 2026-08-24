import { useEffect, useMemo, useRef } from "react";
import { buildBigRoad, tallyResults } from "@golden/game-core/big-road";
import type { RoundHistoryEntry, RoundResult } from "@golden/contracts";

const OUTCOME_LABEL: Record<"player" | "banker", string> = { player: "P", banker: "B" };

/** Max trailing columns kept for the compact lobby-card preview, so the newest results always stay visible. */
const COMPACT_MAX_COLUMNS = 12;

/**
 * Casino-style Big Road scoreboard, built from the room's recent results.
 * In `compact` mode it renders as a small dotted preview (lobby room cards): fewer columns,
 * round cells instead of lettered squares, and a condensed hand-count + tally header.
 */
export function BigRoad({ history, compact = false, prediction, onPredict }: { history: RoundHistoryEntry[]; compact?: boolean; prediction?: RoundResult | null; onPredict?: (result: RoundResult) => void }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const previousLengthRef = useRef(0);
  const displayHistory = useMemo(
    () => prediction && !compact ? [...history, { result: prediction, playerPair: false, bankerPair: false }] : history,
    [compact, history, prediction],
  );
  const { columns: allColumns, leadingTies: allLeadingTies } = buildBigRoad(displayHistory, 6);
  const tally = tallyResults(history);
  const hasData = history.length > 0;

  const columns = compact ? allColumns.slice(-COMPACT_MAX_COLUMNS) : allColumns;
  const leadingTies = compact && allColumns.length > COMPACT_MAX_COLUMNS ? 0 : allLeadingTies;

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.scrollTo({ left: grid.scrollWidth, behavior: previousLengthRef.current > 0 ? "smooth" : "auto" });
    previousLengthRef.current = history.length;
  }, [displayHistory.length]);

  return (
    <div className={compact ? "big-road big-road-compact" : "big-road"}>
      <div className="big-road-head">
        {compact ? <h3>#{history.length}</h3> : <div className="road-predict-controls" role="group" aria-label="다음 결과 예측">
          {(["player", "banker", "tie"] as const).map((result) => <button type="button" key={result} className={prediction === result ? "active" : ""} aria-pressed={prediction === result} onClick={() => onPredict?.(result)}>{OUTCOME_LABEL[result as "player" | "banker"] ?? "T"}</button>)}
        </div>}
        <div className="road-tally">
          <span className="tally-player">P {compact ? tally.player : `${tally.playerPct}%`}</span>
          <span className="tally-banker">B {compact ? tally.banker : `${tally.bankerPct}%`}</span>
          <span className="tally-tie">T {compact ? tally.tie : `${tally.tiePct}%`}</span>
        </div>
      </div>
      <div className="big-road-grid" ref={gridRef}>
        {!hasData && <p className="big-road-empty">라운드가 진행되면 여기에 결과가 쌓입니다.</p>}
        {leadingTies > 0 && (
          <div className="big-road-column">
            {Array.from({ length: leadingTies }).map((_, index) => (
              <span key={`leading-tie-${index}`} className="road-cell tie-only" />
            ))}
          </div>
        )}
        {columns.map((column, columnIndex) => (
          <div className="big-road-column" key={columnIndex}>
            {column.map((cell, rowIndex) => {
              const preview = Boolean(prediction && !compact && columnIndex === columns.length - 1 && rowIndex === column.length - 1);
              return <span key={rowIndex} className={`road-cell ${cell.outcome} ${preview ? "road-preview" : ""}`} style={{ gridRow: cell.row + 1 }}>
                {!compact && OUTCOME_LABEL[cell.outcome]}
                {cell.ties > 0 && <em>{cell.ties > 1 ? cell.ties : ""}</em>}
                {cell.playerPair && <i className="road-pair-dot player-pair-dot" aria-hidden="true" />}
                {cell.bankerPair && <i className="road-pair-dot banker-pair-dot" aria-hidden="true" />}
              </span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
