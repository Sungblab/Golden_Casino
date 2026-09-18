import { useMemo } from "react";
import type { SutdaResultRow } from "@golden/contracts";
// 반드시 깊은 경로로 — 패키지 배럴(@golden/game-core)은 shoe.js 의 node:crypto 까지 끌고 와서
// 브라우저 번들이 통째로 죽는다. 웹에서 game-core 를 쓰는 다른 파일들도 모두 이 규칙을 따른다.
import { SUTDA_RANKINGS, sutdaHandStrength } from "@golden/game-core/sutda";

/**
 * 족보판 — 상용 섯다(피망)가 판 옆에 항상 띄워두는 그 표. 세로로 강한 순이고,
 * 오른쪽 숫자는 "가능한 190개 패 중 이 패가 이기는 비율"(내승률)이다. 내 패가 있으면
 * 그 줄을 짚어 주고, 이미 나보다 위인 줄은 흐리게 눌러 둔다.
 *
 * 우리는 여기까지 강도 미터 다섯 칸으로만 말하고 있었다. 숫자로 보여 주면 "내가 지금
 * 어디쯤인지"가 추측이 아니라 사실이 된다.
 */
export function SutdaLadder({ myLabel }: { myLabel: string | null }) {
  const rows = useMemo(
    () =>
      SUTDA_RANKINGS.map((row) => ({
        label: row.label,
        rank: row.rank,
        tier: row.tier,
        // sutdaHandStrength 는 rank 만 본다 — 참고 행을 그대로 재료로 쓸 수 있다.
        percentile: sutdaHandStrength({ label: row.label, detail: "", rank: row.rank, special: "none" }).percentile,
      })),
    [],
  );
  // 특수패(암행어사·땡잡이·구사)는 끗값이 낮아 사다리에서 제자리를 못 찾는다. 라벨로 짚는다.
  const mineIndex = myLabel ? rows.findIndex((row) => row.label === myLabel) : -1;

  return (
    <div className="sutda-ladder">
      <header>
        <span>족보</span>
        <span className="sutda-ladder-head">내승률</span>
      </header>
      <ol>
        {rows.map((row, index) => {
          const isMine = index === mineIndex;
          const beaten = mineIndex >= 0 && index < mineIndex;
          return (
            <li key={row.label} className={`${isMine ? "is-mine" : ""} ${beaten ? "is-beaten" : ""}`}>
              <b>{row.label}</b>
              <em>{row.percentile}%</em>
            </li>
          );
        })}
      </ol>
      {mineIndex < 0 && myLabel && <p className="sutda-ladder-note">{myLabel}는 끗값으로 겨룹니다</p>}
    </div>
  );
}

/**
 * 게임결과 — 판이 끝나면 전원의 손익을 한 줄씩. 두 상용 섯다 모두 매 판 이 표를 띄우고,
 * 땡값이 붙었으면 괄호로 따로 적어 준다. 우리는 여태 내 결과 한 줄만 보여 주고 있었다.
 */
export function SutdaResultBoard({ rows, rake, ddaeng, mySeat }: { rows: SutdaResultRow[]; rake: number; ddaeng: string | null; mySeat: number | null }) {
  if (rows.length === 0) return null;
  return (
    <div className="sutda-results">
      <header>
        <span>게임결과</span>
        {ddaeng && <b className="sutda-results-ddaeng">{ddaeng} 땡값</b>}
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.seatNumber} className={`${row.outcome === "win" ? "is-win" : ""} ${row.seatNumber === mySeat ? "is-mine" : ""}`}>
            <span className="sutda-results-who">{row.seatNumber === mySeat ? "나" : row.username}</span>
            <span className="sutda-results-hand">{row.handLabel ?? "다이"}</span>
            <span className="sutda-results-net">
              {row.net >= 0 ? "+" : ""}{row.net.toLocaleString()}
              {row.ddaeng !== 0 && <em>{row.ddaeng > 0 ? "땡값 +" : "땡값 "}{row.ddaeng.toLocaleString()}</em>}
            </span>
          </li>
        ))}
      </ul>
      {rake > 0 && <p className="sutda-results-rake">딜러비 {rake.toLocaleString()}코인</p>}
    </div>
  );
}
