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

const FLIGHT_MIN_MS = 360;
/** Flight duration ceiling. Reveal timing is budgeted against this in each shoe game. */
const FLIGHT_MAX_MS = 600;
/** Baccarat, Dragon Tiger and Blackjack use the larger table-to-hand travel. */
const CASINO_FLIGHT_MIN_MS = 400;
const CASINO_FLIGHT_MAX_MS = 680;
/** Cards pause briefly after touchdown instead of beginning to turn in mid-air. */
export const SHOE_REVEAL_HOLD_MS = 140;
/** A slower, readable back-to-face turn for cards dealt from a shoe. */
export const SHOE_FLIP_MS = 800;

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
  const felt = el.closest(".ot-felt");
  const shoe = felt?.querySelector("[data-deck-shoe]");
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
  const isCasinoShoeGame = felt?.classList.contains("baccarat") || felt?.classList.contains("bj");
  const minMs = isCasinoShoeGame ? CASINO_FLIGHT_MIN_MS : FLIGHT_MIN_MS;
  const maxMs = isCasinoShoeGame ? CASINO_FLIGHT_MAX_MS : FLIGHT_MAX_MS;
  const distanceScale = isCasinoShoeGame ? 0.78 : 0.7;
  const ms = Math.round(Math.min(maxMs, Math.max(minMs, Math.hypot(dx, dy) * distanceScale)));
  el.style.setProperty("--card-deal-x", `${Math.round(dx)}px`);
  el.style.setProperty("--card-deal-y", `${Math.round(dy)}px`);
  el.style.setProperty("--card-deal-ms", `${ms}ms`);
  el.style.setProperty("--card-flip-ms", `${SHOE_FLIP_MS}ms`);
  el.dataset.shoeFlightMs = String(ms);
  return ms;
}
