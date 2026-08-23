import type { CSSProperties } from "react";

/** Same five denominations and colors as the chip tray (see BaccaratRoomPage's CHIP_TIERS). */
const CHIP_TIER_COLORS = ["#9a6b28", "#9a3540", "#275c91", "#267450", "#473f3a"];
const CHIP_TIER_VALUES = [1, 5, 10, 25, 100];

function chipTierColor(amount: number): string {
  let color = CHIP_TIER_COLORS[0]!;
  CHIP_TIER_VALUES.forEach((value, index) => {
    if (amount >= value) color = CHIP_TIER_COLORS[index]!;
  });
  return color;
}

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
  const stackStyle = { "--chip-tier": chipTierColor(amount) } as CSSProperties;
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
