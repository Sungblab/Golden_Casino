import type { CSSProperties } from "react";
import { Users } from "lucide-react";
import { chipColorForAmount } from "../lib/betting";

/** How many chips to draw in the stack, purely for visual weight (capped so it never overflows the zone). */
function chipLayerCount(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < 5) return 1;
  if (amount < 25) return 2;
  if (amount < 100) return 3;
  return 4;
}

export function BetZone({
  className,
  label,
  odds,
  amount,
  disabled,
  onPlace,
  buttonRef,
  sharePercent,
  players,
}: {
  className: string;
  label: string;
  odds: string;
  amount: number;
  disabled: boolean;
  onPlace: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  /** Room-wide, not just mine: this zone's share (0–100) of everything staked this round. */
  sharePercent?: number;
  /** Room-wide count of distinct players with a live bet on this zone right now. */
  players?: number;
}) {
  const layers = chipLayerCount(amount);
  const stackStyle = { "--chip-tier": chipColorForAmount(amount) } as CSSProperties;
  return (
    <div className={`bet-zone ${className} ${amount > 0 ? "has-bet" : ""}`}>
      {typeof sharePercent === "number" && typeof players === "number" && players > 0 && (
        <div className="bet-zone-live" aria-hidden="true">
          <span className="bet-zone-live-share">{sharePercent}%</span>
          <span className="bet-zone-live-players"><Users size={9} /> {players}</span>
        </div>
      )}
      <button ref={buttonRef} type="button" className="bet-zone-surface" disabled={disabled} onClick={onPlace}>
        <strong>{label}</strong>
        <small>{odds}</small>
      </button>
      {amount > 0 && (
        // No per-chip cancel here — the rail's "전체 베팅 되돌리기" (undo) button already
        // covers clearing a bet, and a redundant X on every chip stack was clutter.
        <span className="chip-stack" style={stackStyle} aria-label={`${label} 베팅 ${amount}코인`}>
          {Array.from({ length: Math.max(0, layers - 1) }).map((_, index) => (
            <span key={index} className="chip-stack-layer" style={{ bottom: index * 3 }} />
          ))}
          <span className="chip-stack-top">{amount}</span>
        </span>
      )}
    </div>
  );
}
