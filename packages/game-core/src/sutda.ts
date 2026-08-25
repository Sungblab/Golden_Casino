import { randomInt } from "node:crypto";
import type { HwatuCard } from "@golden/contracts";

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
    const j = randomInt(i + 1);
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
  if (hasMonths(cards, 3, 7) && cards.some((c) => c.month === 3 && c.kind === "hikari") && cards.some((c) => c.month === 7 && c.kind === "tane")) return { label: "땡잡이", detail: "장땡·광땡을 제외한 땡을 잡음", rank: 0, special: "ddang_catcher" };
  if (hasMonths(cards, 4, 9) && cards.every((c) => c.kind === "tane")) return { label: "멍텅구리 구사", detail: "상위 패가 없으면 재경기", rank: 0, special: "mungu" };
  if (hasMonths(cards, 4, 7) && cards.every((c) => c.kind === "tane")) return { label: "암행어사", detail: "13·18광땡을 잡음", rank: 0, special: "ambassador" };
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
  const has38 = values.some((hand) => hand.label === "38광땡");
  const hasJang = values.some((hand) => hand.label === "장땡");
  if (values.some((hand) => hand.special === "mungu") && !has38 && !hasJang && !values.some((hand) => hand.rank >= 990)) return { winnerIds: [], handByUser, redeal: true };
  const ambassador = [...handByUser.entries()].filter(([, hand]) => hand.special === "ambassador");
  if (!has38 && values.some((hand) => hand.rank === 990) && ambassador.length) return { winnerIds: ambassador.map(([userId]) => userId), handByUser, redeal: false };
  const catcher = [...handByUser.entries()].filter(([, hand]) => hand.special === "ddang_catcher");
  if (!has38 && !hasJang && values.some((hand) => hand.rank >= 901 && hand.rank <= 909) && catcher.length) return { winnerIds: catcher.map(([userId]) => userId), handByUser, redeal: false };
  const best = Math.max(...values.map((hand) => hand.rank));
  return { winnerIds: [...handByUser.entries()].filter(([, hand]) => hand.rank === best).map(([userId]) => userId), handByUser, redeal: false };
}
