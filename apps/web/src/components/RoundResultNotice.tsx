import { CircleCheckBig, CircleX, Minus } from "lucide-react";

export interface RoundResultNoticeData {
  net: number;
  title: string;
}

/** Non-blocking settlement feedback that stays readable without interrupting the next round. */
export function RoundResultNotice({ notice }: { notice: RoundResultNoticeData | null }) {
  if (!notice) return null;
  const tone = notice.net > 0 ? "win" : notice.net < 0 ? "lose" : "push";
  const Icon = tone === "win" ? CircleCheckBig : tone === "lose" ? CircleX : Minus;
  return (
    <div className={`round-result-notice ${tone}`} role="status" aria-live="assertive">
      <span className="round-result-icon" aria-hidden="true"><Icon size={25} /></span>
      <span className="round-result-copy">
        <small>MY RESULT</small>
        <strong>{notice.title}</strong>
      </span>
      <span className="round-result-net">
        {notice.net > 0 ? "+" : ""}{notice.net.toLocaleString()}<small>코인</small>
      </span>
    </div>
  );
}
