import type { Card } from "@golden/contracts";
import { CardFace } from "./CardFace";
import { openGameGuide } from "./GameShell";
import { HandStrengthMeter } from "./PvpBits";
import { cardKey, type HoldemHandRead } from "../lib/holdemHandRead";

/**
 * The viewer's live hand read — "지금 내가 뭘 들고 있는지" without opening the
 * 족보 reference. Only ever renders the viewer's OWN hand (see holdemHandRead),
 * hence the explicit "나만 보여요" note: on a shared screen it has to be obvious
 * this is private information and not a public reveal.
 *
 * Beyond the name of the hand it answers the two questions a beginner actually
 * has: how good is it (the five-step meter) and what could it still become (the
 * draw lines on the flop and turn).
 *
 * One markup for both layouts — the bottom-dock variant is the same elements
 * reflowed by CSS (table-pvp.css), not a second branch here, so the two can
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
            <span key={index} className={`holdem-hand-panel-card ${read.usedKeys.has(cardKey(card)) ? "is-in-hand" : ""}`}><CardFace card={card} /></span>
          ))}
        </div>
        <div className="holdem-hand-panel-text">
          <strong>{read.label}</strong>
          <span>{read.detail}</span>
        </div>
      </div>
      <HandStrengthMeter tier={read.tier} label={read.tierLabel} detail={read.evaluated ? "현재 조합 기준" : "시작 패 기준"} />
      {read.draws.length > 0 && (
        <ul className="hand-panel-draws" aria-label="드로우">
          {read.draws.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      <button type="button" className="hand-panel-link" onClick={() => openGameGuide("rankings")}>족보표 전체 보기</button>
    </div>
  );
}
