import type { CSSProperties } from "react";
import { chipColorForAmount } from "../lib/betting";

/** How many chips to draw in the stack, purely for visual weight (capped so it never overflows). */
function chipLayerCount(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < 5) return 1;
  if (amount < 25) return 2;
  if (amount < 100) return 3;
  return 4;
}

/**
 * A layered chip visual for a placed bet amount. Shared by BetZone (baccarat/blackjack, where it
 * sits pinned to a zone's corner) and the poker-family seats/stakes (holdem, casino holdem, sutda,
 * dragon tiger), where the surrounding layout puts it in normal flow instead — see the
 * `.holdem-seat .chip-stack` / `.ch-stakes .chip-stack` overrides in styles.css.
 */
export function ChipStack({ amount, label, className }: { amount: number; label: string; className?: string }) {
  if (amount <= 0) return null;
  const layers = chipLayerCount(amount);
  const stackStyle = { "--chip-tier": chipColorForAmount(amount) } as CSSProperties;
  return (
    <span className={`chip-stack${className ? ` ${className}` : ""}`} style={stackStyle} aria-label={`${label} ${amount}코인`}>
      {Array.from({ length: Math.max(0, layers - 1) }).map((_, index) => (
        <span key={index} className="chip-stack-layer" style={{ bottom: index * 3 }} />
      ))}
      <span className="chip-stack-top">{amount}</span>
    </span>
  );
}
