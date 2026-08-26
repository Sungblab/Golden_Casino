import type { Card } from "@golden/contracts";
import { CardFace } from "./CardFace";
import type { HoldemHandRead } from "../lib/holdemHandRead";

/**
 * The viewer's live hand read — "지금 내가 뭘 들고 있는지" without opening the
 * 족보 reference. Only ever renders the viewer's OWN hand (see holdemHandRead),
 * hence the explicit "나만 보여요" note: on a shared screen it has to be obvious
 * this is private information and not a public reveal.
 *
 * One markup for both layouts — the bottom-bar variant is the same elements
 * reflowed by CSS (table-holdem.css), not a second branch here, so the two can
 * never drift apart.
 */
export function HoldemHandPanel({ read, holeCards }: { read: HoldemHandRead; holeCards: Card[] }) {
  return (
    <div className={`holdem-hand-panel ${read.evaluated ? "" : "is-hint"}`}>
      <header>
        <span className="holdem-hand-panel-eyebrow">내 족보</span>
        <span className="holdem-hand-panel-private">나만 보여요</span>
      </header>
      <div className="holdem-hand-panel-body">
        <div className="holdem-hand-panel-cards" aria-hidden="true">
          {holeCards.map((card, index) => (
            <span key={index} className="holdem-hand-panel-card"><CardFace card={card} /></span>
          ))}
        </div>
        <div className="holdem-hand-panel-text">
          <strong>{read.label}</strong>
          <span>{read.detail}</span>
        </div>
      </div>
    </div>
  );
}
