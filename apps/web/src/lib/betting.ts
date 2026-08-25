const CHIP_CANDIDATES = [1, 5, 10, 25, 50, 100, 250, 500] as const;

/**
 * Chip face colours, one per denomination tier. These are the single source of truth:
 * the CSS mirrors them as --chip-0…--chip-4 for the tray/stack/picker, and the flying-chip
 * animation reads them from here. Keep the two in sync — a chip that changes colour
 * mid-flight is the tell that they drifted apart.
 */
export const CHIP_TIER_COLORS = ["#b8761c", "#c2202f", "#1a5fb4", "#0f8a50", "#2f2620"] as const;

/**
 * The lighter edge-spot colour printed around each tier's rim, mirroring --chip-N-rim.
 * These are literals rather than a color-mix() of the face because a custom property holding
 * an unsupported function parses fine and only fails once it is substituted into the chip's
 * `background`, which silently drops the whole disc and leaves just the amount label.
 */
export const CHIP_TIER_RIM_COLORS = ["#e0a341", "#ee5464", "#4a93e0", "#34ba79", "#6b5a48"] as const;

/** Lowest denomination each tier starts at, used to colour an arbitrary bet total. */
const CHIP_TIER_FLOORS = [1, 5, 10, 50, 100] as const;

/** Tier index for an arbitrary amount (a settled bet total, not a tray denomination). */
function chipTierForAmount(amount: number): number {
  let tier = 0;
  CHIP_TIER_FLOORS.forEach((floor, index) => {
    if (amount >= floor) tier = index;
  });
  return tier;
}

/** Tier face colour for an arbitrary amount. */
export function chipColorForAmount(amount: number): string {
  return CHIP_TIER_COLORS[chipTierForAmount(amount)]!;
}

/** Tier rim colour for an arbitrary amount, paired with chipColorForAmount. */
export function chipRimForAmount(amount: number): string {
  return CHIP_TIER_RIM_COLORS[chipTierForAmount(amount)]!;
}

/** Chip denominations tailored to a room, always including its exact limits. */
export function chipValuesForRoom(minBet: number, maxBet: number): number[] {
  return [...new Set([minBet, ...CHIP_CANDIDATES.filter((value) => value >= minBet && value <= maxBet), maxBet])]
    .sort((a, b) => a - b);
}

export function chipTier(value: number): number {
  if (value < 5) return 0;
  if (value < 10) return 1;
  if (value < 50) return 2;
  if (value < 100) return 3;
  return 4;
}

/** Maximum legal next click, capped by both wallet and the room's round limit. */
export function maximumAdditionalBet(wallet: number, currentBet: number, maxBet: number): number {
  return Math.max(0, Math.min(Math.floor(wallet), maxBet - currentBet));
}
