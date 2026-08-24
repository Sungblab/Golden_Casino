import type { CSSProperties } from "react";
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
  onCancel,
  buttonRef,
}: {
  className: string;
  label: string;
  odds: string;
  amount: number;
  disabled: boolean;
  onPlace: () => void;
  onCancel: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const layers = chipLayerCount(amount);
  const stackStyle = { "--chip-tier": chipColorForAmount(amount) } as CSSProperties;
  return (
    <div className={`bet-zone ${className} ${amount > 0 ? "has-bet" : ""}`}>
      <button ref={buttonRef} type="button" className="bet-zone-surface" disabled={disabled} onClick={onPlace}>
        <strong>{label}</strong>
        <small>{odds}</small>
      </button>
      {amount > 0 && (
        <span className="chip-stack" style={stackStyle} aria-label={`${label} 베팅 ${amount}코인`}>
          {Array.from({ length: Math.max(0, layers - 1) }).map((_, index) => (
            <span key={index} className="chip-stack-layer" style={{ bottom: index * 3 }} />
          ))}
          <span className="chip-stack-top">{amount}</span>
          {!disabled && (
            <button type="button" className="chip-cancel" title="이 베팅 취소" onClick={onCancel}>
              ×
            </button>
          )}
        </span>
      )}
    </div>
  );
}
