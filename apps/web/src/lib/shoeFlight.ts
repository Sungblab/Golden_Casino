/**
 * Launches a card's deal animation from the table's dealing shoe instead of the
 * keyframe's stock offset. The shoe is whatever element inside the same
 * `.ot-felt` carries `data-deck-shoe` (see components/DeckShoe); tables without
 * one — holdem, sutda, cards rendered outside a felt — keep the stock entry.
 *
 * Call from a mount-time ref or layout effect, before first paint: it writes
 * `--card-deal-x/y/ms` inline so the `card-enter` keyframe's `from` state reads
 * the measured values on its very first frame.
 */

const FLIGHT_MIN_MS = 280;
/**
 * Also the ceiling on how far a card's flip can be pushed back (flip waits for
 * touchdown, see PlayingCard) — the baccarat/dragon-tiger ROAD_REVEAL delays
 * are budgeted against this cap, so raising it means revisiting those.
 */
const FLIGHT_MAX_MS = 420;
/** How long before touchdown a flip may begin — most of the .55s flip still plays after landing. */
export const FLIP_LEAD_MS = 180;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Returns the flight duration in ms, or 0 when the card enters the stock way. */
export function applyShoeFlight(el: HTMLElement | null): number {
  if (!el || prefersReducedMotion()) return 0;
  // One flight per element, ever. Suspending the animation to measure (below) also
  // *restarts* it, so a caller that re-runs this on an already-launched card — an
  // inline `ref` callback, which React reattaches on every render — would fire a
  // fresh card out of the shoe on each render. Blackjack's dealer hole card sat
  // there re-flying every snapshot tick because of exactly that. The card-enter
  // keyframe only plays on mount anyway, so a cached result is also the correct one.
  const cached = el.dataset.shoeFlightMs;
  if (cached !== undefined) return Number(cached);
  const shoe = el.closest(".ot-felt")?.querySelector("[data-deck-shoe]");
  if (!shoe) return 0;
  // The enter animation fills backwards, so before first paint the element may
  // already measure at the keyframe's translated `from` position — suspend it
  // for the measurement or the delta comes out offset by the stock entry.
  const suspended = el.style.animation;
  el.style.animation = "none";
  const to = el.getBoundingClientRect();
  el.style.animation = suspended;
  if (to.width === 0 && to.height === 0) return 0;
  const from = shoe.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const ms = Math.round(Math.min(FLIGHT_MAX_MS, Math.max(FLIGHT_MIN_MS, Math.hypot(dx, dy) * 0.55)));
  el.style.setProperty("--card-deal-x", `${Math.round(dx)}px`);
  el.style.setProperty("--card-deal-y", `${Math.round(dy)}px`);
  el.style.setProperty("--card-deal-ms", `${ms}ms`);
  el.dataset.shoeFlightMs = String(ms);
  return ms;
}
