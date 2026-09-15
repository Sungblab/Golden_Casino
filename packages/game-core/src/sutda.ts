import type { HwatuCard } from "@golden/contracts";
// Web Crypto (not node:crypto) so the web client can import this module for the 족보 guide and
// hand-strength reads without pulling a Node built-in into the bundle.
import { secureRandomInt } from "./lightning.js";

export interface SutdaHand {
  label: string;
  detail: string;
  rank: number;
  /** These cards have conditional online-Sutda effects.  The room actor applies them at showdown. */
  special: "none" | "ambassador" | "ddang_catcher" | "mungu";
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October"];
const card = (month: number, kind: HwatuCard["kind"]): HwatuCard => ({ id: `${MONTH_NAMES[month]}_${kind[0]!.toUpperCase()}${kind.slice(1)}`, month, kind });

/** The traditional 20-card Sutda deck, cut from the supplied 48-card hwatu set. */
export function createSutdaDeck(): HwatuCard[] {
  const cards: HwatuCard[] = [];
  for (let month = 1; month <= 10; month += 1) {
    cards.push(card(month, month === 1 || month === 3 || month === 8 ? "hikari" : "tanzaku"));
    cards.push(card(month, month === 1 || month === 3 ? "tanzaku" : "tane"));
  }
  return cards;
}

export function shuffleSutdaDeck(cards = createSutdaDeck()): HwatuCard[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

const isGwang = (c: HwatuCard) => c.kind === "hikari" && (c.month === 1 || c.month === 3 || c.month === 8);
const hasMonths = (cards: HwatuCard[], a: number, b: number) => cards.some((c) => c.month === a) && cards.some((c) => c.month === b);

export function evaluateSutdaHand(cards: HwatuCard[]): SutdaHand {
  if (cards.length !== 2) throw new Error("Sutda evaluation requires exactly two cards");
  const [a, b] = cards;
  const months = [a!.month, b!.month].sort((x, y) => x - y);
  const bothGwang = isGwang(a!) && isGwang(b!);
  if (bothGwang && months[0] === 3 && months[1] === 8) return { label: "38광땡", detail: "섯다 최강 패", rank: 1000, special: "none" };
  if (bothGwang && ((months[0] === 1 && months[1] === 3) || (months[0] === 1 && months[1] === 8))) return { label: `${months[0]}${months[1]}광땡`, detail: "암행어사를 제외하면 최상위", rank: 990, special: "none" };
  if (a!.month === b!.month) return { label: a!.month === 10 ? "장땡" : `${a!.month}땡`, detail: "같은 월 두 장", rank: 900 + a!.month, special: "none" };
  // Standard online variants use these particular picture cards for special hands.
  // When a special hand's catch/redeal does NOT trigger, it competes as its ordinary 끗
  // total — that is the standard rule, and `rank` here is exactly that fallback:
  // 땡잡이 3+7=10 → 망통(0), 멍텅구리 구사 4+9=13 → 3끗, 암행어사 4+7=11 → 1끗. These used
  // to all be 0, which made an idle 암행어사/구사 lose to (or tie with) 망통.
  if (hasMonths(cards, 3, 7) && cards.some((c) => c.month === 3 && c.kind === "hikari") && cards.some((c) => c.month === 7 && c.kind === "tane")) return { label: "땡잡이", detail: "장땡·광땡을 제외한 땡을 잡음", rank: 0, special: "ddang_catcher" };
  if (hasMonths(cards, 4, 9) && cards.every((c) => c.kind === "tane")) return { label: "멍텅구리 구사", detail: "상위 패가 없으면 재경기", rank: 3, special: "mungu" };
  if (hasMonths(cards, 4, 7) && cards.every((c) => c.kind === "tane")) return { label: "암행어사", detail: "13·18광땡을 잡음", rank: 1, special: "ambassador" };
  const named: Record<string, string> = { "1-2": "알리", "1-4": "독사", "1-9": "구삥", "1-10": "장삥", "4-10": "장사", "4-6": "세륙" };
  const key = `${months[0]}-${months[1]}`;
  const label = named[key];
  if (label) return { label, detail: "특수 끗 족보", rank: 800 - ["알리", "독사", "구삥", "장삥", "장사", "세륙"].indexOf(label), special: "none" };
  const end = (a!.month + b!.month) % 10;
  return { label: end === 9 ? "갑오" : end === 0 ? "망통" : `${end}끗`, detail: "두 월 수의 합의 일의 자리", rank: end === 9 ? 700 : end, special: "none" };
}

/** Applies the widely used online special-card hierarchy to completed hands. */
export function resolveSutdaWinners(hands: Array<{ userId: string; cards: HwatuCard[] }>): { winnerIds: string[]; handByUser: Map<string, SutdaHand>; redeal: boolean } {
  const handByUser = new Map(hands.map((entry) => [entry.userId, evaluateSutdaHand(entry.cards)]));
  const values = [...handByUser.values()];
  const best = Math.max(...values.map((hand) => hand.rank));
  // 멍텅구리 구사 forces a redeal unless someone holds a 광땡 or 장땡 (rank ≥ 910).
  if (values.some((hand) => hand.special === "mungu") && best <= 909) return { winnerIds: [], handByUser, redeal: true };
  // 암행어사 catches 13·18광땡 (990) — but never 38광땡 (1000), which simply wins on rank.
  const ambassador = [...handByUser.entries()].filter(([, hand]) => hand.special === "ambassador");
  if (best === 990 && ambassador.length) return { winnerIds: ambassador.map(([userId]) => userId), handByUser, redeal: false };
  // 땡잡이 catches 1땡~9땡 only when such a 땡 is the strongest hand on the table. It used to
  // fire whenever *any* 1~9땡 was present, so a 땡잡이 also beat a 13·18광땡 sitting at the same
  // table — a hand it can't catch and would otherwise lose to as 망통.
  const catcher = [...handByUser.entries()].filter(([, hand]) => hand.special === "ddang_catcher");
  if (best >= 901 && best <= 909 && catcher.length) return { winnerIds: catcher.map(([userId]) => userId), handByUser, redeal: false };
  return { winnerIds: [...handByUser.entries()].filter(([, hand]) => hand.rank === best).map(([userId]) => userId), handByUser, redeal: false };
}

// ---------------------------------------------------------------------------
// Beginner-facing reference data: the ranking table the in-game 족보 guide draws,
// a strength read for the viewer's own hand, and the "what could my second card
// make" outlook shown after the first card. Pure functions over the fixed
// 20-card deck, so the client can run them without any server round trip.
// ---------------------------------------------------------------------------

export type SutdaTier = "gwangddaeng" | "ddaeng" | "named" | "gabo" | "kkeut" | "mangtong";

export const SUTDA_TIER_LABEL: Record<SutdaTier, string> = {
  gwangddaeng: "광땡",
  ddaeng: "땡",
  named: "특수 족보",
  gabo: "갑오",
  kkeut: "끗",
  mangtong: "망통",
};

/** Tier of a hand by its ordinary (non-special) rank. */
export function sutdaTierOf(rank: number): SutdaTier {
  if (rank >= 990) return "gwangddaeng";
  if (rank >= 901) return "ddaeng";
  if (rank >= 795) return "named";
  if (rank === 700) return "gabo";
  if (rank > 0) return "kkeut";
  return "mangtong";
}

export interface SutdaRankingRow {
  label: string;
  tier: SutdaTier;
  /** A representative pair for the guide's card illustration. */
  cards: [HwatuCard, HwatuCard];
  rank: number;
  /** One line a first-time player can act on. */
  note: string;
}

const deckCard = (month: number, kind: HwatuCard["kind"]): HwatuCard => {
  const found = createSutdaDeck().find((c) => c.month === month && c.kind === kind);
  if (!found) throw new Error(`No ${month}월 ${kind} in the Sutda deck`);
  return found;
};

/** Every regular 족보, strongest first — exactly the order `evaluateSutdaHand` ranks them in. */
export const SUTDA_RANKINGS: SutdaRankingRow[] = (() => {
  const rows: SutdaRankingRow[] = [];
  const push = (a: HwatuCard, b: HwatuCard, note: string) => {
    const hand = evaluateSutdaHand([a, b]);
    rows.push({ label: hand.label, tier: sutdaTierOf(hand.rank), cards: [a, b], rank: hand.rank, note });
  };
  push(deckCard(3, "hikari"), deckCard(8, "hikari"), "3월 광 + 8월 광. 어떤 패에도 지지 않는 최강 족보");
  push(deckCard(1, "hikari"), deckCard(8, "hikari"), "1월 광 + 8월 광. 38광땡과 암행어사에만 진다");
  push(deckCard(1, "hikari"), deckCard(3, "hikari"), "1월 광 + 3월 광. 18광땡과 같은 급");
  const secondKind = (month: number): HwatuCard["kind"] => (month === 1 || month === 3 ? "tanzaku" : "tane");
  const firstKind = (month: number): HwatuCard["kind"] => (month === 1 || month === 3 || month === 8 ? "hikari" : "tanzaku");
  for (let month = 10; month >= 1; month -= 1) {
    push(deckCard(month, firstKind(month)), deckCard(month, secondKind(month)), month === 10 ? "10월 두 장. 땡 중 최고, 땡잡이에 잡히지 않는다" : month === 1 ? "1월 두 장(삥땡). 땡 중 가장 낮다" : `${month}월 두 장. 숫자가 높을수록 강하다`);
  }
  push(deckCard(1, "tanzaku"), deckCard(2, "tane"), "1월 + 2월. 땡 아래 최고 족보");
  push(deckCard(1, "tanzaku"), deckCard(4, "tanzaku"), "1월 + 4월");
  push(deckCard(1, "tanzaku"), deckCard(9, "tanzaku"), "1월 + 9월");
  push(deckCard(1, "tanzaku"), deckCard(10, "tanzaku"), "1월 + 10월");
  push(deckCard(4, "tanzaku"), deckCard(10, "tanzaku"), "4월 + 10월");
  push(deckCard(4, "tanzaku"), deckCard(6, "tanzaku"), "4월 + 6월. 특수 족보 중 가장 낮다");
  push(deckCard(4, "tanzaku"), deckCard(5, "tanzaku"), "두 월의 합이 9 (예: 4+5). 끗 중 최고");
  const kkeutExample: Record<number, [number, number]> = { 8: [2, 6], 7: [2, 5], 6: [2, 4], 5: [2, 3], 4: [1, 3], 3: [1, 2], 2: [3, 9], 1: [5, 6] };
  for (let end = 8; end >= 1; end -= 1) {
    const [m1, m2] = kkeutExample[end]!;
    // 1+2 is 알리 and 1+3 with two 광s is 13광땡 — pick kinds that keep these plain 끗 examples.
    const a = end === 3 ? deckCard(3, "tanzaku") : deckCard(m1, firstKind(m1));
    const b = end === 3 ? deckCard(10, "tanzaku") : deckCard(m2, secondKind(m2));
    push(a, b, `두 월의 합의 일의 자리가 ${end} (예: ${a.month}+${b.month})`);
  }
  push(deckCard(2, "tanzaku"), deckCard(8, "tane"), "합의 일의 자리가 0 (예: 2+8). 가장 낮은 패");
  return rows;
})();

export interface SutdaSpecialRow {
  label: string;
  cards: [HwatuCard, HwatuCard];
  effect: string;
  fallback: string;
}

/** The three conditional hands, with what they do and what they count as otherwise. */
export const SUTDA_SPECIALS: SutdaSpecialRow[] = [
  { label: "암행어사", cards: [deckCard(4, "tane"), deckCard(7, "tane")], effect: "상대가 13광땡·18광땡이면 그 패를 잡고 이긴다", fallback: "광땡이 없으면 1끗으로 승부" },
  { label: "땡잡이", cards: [deckCard(3, "hikari"), deckCard(7, "tane")], effect: "가장 높은 패가 1땡~9땡이면 그 땡을 잡고 이긴다 (장땡·광땡 제외)", fallback: "땡이 없으면 망통으로 승부" },
  { label: "멍텅구리 구사", cards: [deckCard(4, "tane"), deckCard(9, "tane")], effect: "장땡·광땡이 없으면 판을 무효로 하고 다시 친다 (재경기)", fallback: "장땡·광땡이 있으면 3끗으로 승부" },
];

/** Every two-card combination in the deck (190), ranked once at module load. */
const ALL_COMBOS: SutdaHand[] = (() => {
  const deck = createSutdaDeck();
  const combos: SutdaHand[] = [];
  for (let i = 0; i < deck.length; i += 1) for (let j = i + 1; j < deck.length; j += 1) combos.push(evaluateSutdaHand([deck[i]!, deck[j]!]));
  return combos;
})();

export interface SutdaHandStrength {
  tier: SutdaTier;
  tierLabel: string;
  /** How many of the other 189 possible hands this one beats outright. */
  beats: number;
  /** How many of the other 189 possible hands tie with it. */
  ties: number;
  total: number;
  /** 0–100: share of the other possible hands this one beats. */
  percentile: number;
}

/**
 * Where a hand sits among every possible two-card holding — the number the
 * strength meter shows. Special hands are measured at their fallback rank; their
 * catch/redeal effect is explained separately and never counted here.
 */
export function sutdaHandStrength(hand: SutdaHand): SutdaHandStrength {
  const others = ALL_COMBOS.length - 1;
  let beats = 0;
  let ties = -1; // the hand itself is in ALL_COMBOS
  for (const combo of ALL_COMBOS) {
    if (combo.rank < hand.rank) beats += 1;
    else if (combo.rank === hand.rank) ties += 1;
  }
  const tier = sutdaTierOf(hand.rank);
  return { tier, tierLabel: SUTDA_TIER_LABEL[tier], beats, ties: Math.max(0, ties), total: others, percentile: Math.round((beats / others) * 100) };
}

export interface SutdaOutlookEntry {
  label: string;
  rank: number;
  tier: SutdaTier;
  /** The second cards that would make this hand. */
  cards: HwatuCard[];
}

/**
 * With one card dealt, every hand the second card could still make, strongest
 * first. Nineteen cards remain from the viewer's point of view; some may already
 * sit in other hands, so this is a "what to hope for", not a probability.
 */
export function sutdaSecondCardOutlook(first: HwatuCard): SutdaOutlookEntry[] {
  const byLabel = new Map<string, SutdaOutlookEntry>();
  for (const second of createSutdaDeck()) {
    if (second.id === first.id) continue;
    const hand = evaluateSutdaHand([first, second]);
    const entry = byLabel.get(hand.label) ?? { label: hand.label, rank: hand.rank, tier: sutdaTierOf(hand.rank), cards: [] };
    entry.cards.push(second);
    byLabel.set(hand.label, entry);
  }
  return [...byLabel.values()].sort((a, b) => b.rank - a.rank);
}
