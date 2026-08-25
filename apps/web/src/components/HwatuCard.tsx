import type { HwatuCard as Hwatu } from "@golden/contracts";

const MONTH: Record<number, string> = { 1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July", 8: "August", 9: "September", 10: "October" };
const KIND: Record<Hwatu["kind"], string> = { hikari: "Hikari", tanzaku: "Tanzaku", tane: "Tane", kasu: "Kasu_1" };

export function hwatuFaceUrl(card: Hwatu): string { return `/cards/hwatu/Hwatu_${MONTH[card.month]}_${KIND[card.kind]}.png`; }

export function HwatuCard({ card, hidden = false }: { card?: Hwatu; hidden?: boolean }) {
  if (hidden || !card) return <span className="hwatu-card hwatu-back" aria-label="상대 패" />;
  return <img className="hwatu-card" src={hwatuFaceUrl(card)} draggable={false} alt={`${card.month}월 화투`} />;
}
