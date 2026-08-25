import { Users } from "lucide-react";
import { ChipStack } from "./ChipStack";

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
      {/* No per-chip cancel here — the rail's "전체 베팅 되돌리기" (undo) button already
          covers clearing a bet, and a redundant X on every chip stack was clutter. */}
      <ChipStack amount={amount} label={`${label} 베팅`} />
    </div>
  );
}
