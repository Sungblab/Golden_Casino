import { SUTDA_RANKINGS, SUTDA_SPECIALS, SUTDA_TIER_LABEL, type SutdaRankingRow, type SutdaTier } from "@golden/game-core/sutda";
import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";
import { HwatuCard } from "../../components/HwatuCard";

const TIER_ORDER: SutdaTier[] = ["gwangddaeng", "ddaeng", "named", "gabo", "kkeut", "mangtong"];

function RankingRow({ row, rank }: { row: SutdaRankingRow; rank: number }) {
  return (
    <li className={`guide-rank-row tier-${row.tier}`}>
      <span className="guide-rank-num">{rank}</span>
      <span className="guide-rank-cards guide-rank-cards-hwatu" aria-hidden="true">
        {row.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
      </span>
      <span className="guide-rank-text">
        <strong>{row.label}</strong>
        <small>{row.note}</small>
      </span>
    </li>
  );
}

function SutdaRankingList() {
  // 8끗~1끗 are one rule, not eight separate things to memorise — collapse them
  // into a single row between 갑오 and 망통 so the list stays scannable.
  const kkeutRows = SUTDA_RANKINGS.filter((row) => row.tier === "kkeut");
  let position = 0;
  return (
    <div className="guide-rank-groups">
      {TIER_ORDER.map((tier) => {
        const rows = SUTDA_RANKINGS.filter((row) => row.tier === tier);
        if (rows.length === 0) return null;
        if (tier === "kkeut") {
          position += rows.length;
          const first = kkeutRows[0]!;
          return (
            <section key={tier} className={`guide-rank-group tier-${tier}`}>
              <h4>{SUTDA_TIER_LABEL[tier]} <span>8끗 → 1끗</span></h4>
              <ul>
                <li className="guide-rank-row tier-kkeut">
                  <span className="guide-rank-num">…</span>
                  <span className="guide-rank-cards guide-rank-cards-hwatu" aria-hidden="true">
                    {first.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
                  </span>
                  <span className="guide-rank-text">
                    <strong>8끗 ~ 1끗</strong>
                    <small>두 장의 월 수를 더한 값의 일의 자리. 예: 2월+6월 = 8끗, 5월+6월 = 11 → 1끗. 숫자가 클수록 강해요</small>
                  </span>
                </li>
              </ul>
            </section>
          );
        }
        return (
          <section key={tier} className={`guide-rank-group tier-${tier}`}>
            <h4>
              {SUTDA_TIER_LABEL[tier]}
              {tier === "ddaeng" && <span>장땡 → 삥땡</span>}
              {tier === "named" && <span>땡 아래, 갑오 위</span>}
            </h4>
            <ul>
              {rows.map((row) => {
                position += 1;
                return <RankingRow key={row.label} row={row} rank={position} />;
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SutdaSpecialList() {
  return (
    <ul className="guide-special-list">
      {SUTDA_SPECIALS.map((row) => (
        <li key={row.label} className="guide-special-row">
          <span className="guide-rank-cards guide-rank-cards-hwatu" aria-hidden="true">
            {row.cards.map((card) => <HwatuCard key={card.id} card={card} />)}
          </span>
          <span className="guide-rank-text">
            <strong>{row.label}</strong>
            <small className="is-effect">{row.effect}</small>
            <small>{row.fallback}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const sutdaGuide: GameGuideContent = {
  gameKey: "sutda",
  title: "섯다",
  intro: "화투 2장으로 족보를 만들어 겨루는 게임. 족보가 가장 높은 사람이 판돈(팟)을 모두 가져갑니다.",
  sections: [
    {
      id: "rankings",
      title: "족보표",
      content: (
        <>
          <GuideNote>위에 있을수록 강한 패예요. 같은 족보끼리는 무승부(팟을 나눠 가짐)이고, 끗은 숫자가 클수록 이깁니다.</GuideNote>
          <SutdaRankingList />
          <GuideHeading sub="상황에 따라 효과가 바뀌는 패">특수 패</GuideHeading>
          <SutdaSpecialList />
        </>
      ),
    },
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "자리에 앉고 준비 완료", body: "빈 자리를 누르면 앉을 수 있어요. 앉은 사람 모두가 준비 완료를 누르면 판이 시작됩니다 (2명 이상)." },
              { title: "삥(기본 베팅) 자동 납부", body: "판이 시작되면 참가자 전원이 기본 베팅(삥)을 자동으로 냅니다. 이 돈이 첫 판돈이에요." },
              { title: "첫 패 1장 → 1차 베팅", body: "한 장을 받고 순서대로 베팅합니다. 내 차례에는 20초 안에 다이 · 체크/콜 · 하프 중 하나를 고르세요." },
              { title: "둘째 패 1장 → 2차 베팅", body: "남은 사람은 두 번째 장을 받고 한 번 더 베팅합니다. 이제 내 족보가 확정돼요." },
              { title: "승부", body: "남은 사람끼리 족보를 비교해 가장 높은 사람이 팟을 가져갑니다. 나 빼고 전부 다이하면 비교 없이 내가 이겨요." },
            ]}
          />
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "다이", tone: "red", body: "이번 판을 포기합니다. 지금까지 낸 돈은 돌려받지 못하지만, 더 잃지도 않아요." },
              { label: "체크", tone: "gold", body: "돈을 더 내지 않고 차례를 넘깁니다. 아무도 올리지 않았을 때만 가능해요." },
              { label: "콜", tone: "blue", body: "상대가 올린 금액만큼 똑같이 맞춰 냅니다. 판에 계속 남으려면 콜 또는 하프를 해야 해요." },
              { label: "하프", tone: "green", body: "콜을 한 뒤 판돈의 절반만큼 더 올립니다. 버튼에 적힌 금액이 이번에 내는 총액이에요." },
            ]}
          />
          <GuideNote tone="red">20초 안에 아무것도 고르지 않으면 자동으로 체크(올린 사람이 없을 때) 또는 다이 처리됩니다.</GuideNote>
          <GuideNote>테이블마다 최대 베팅 한도가 있어서 하프로 올릴 수 있는 금액은 한도까지만 커집니다. 잔액이 콜 금액보다 적으면 다이만 가능해요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "족보", body: "패 2장의 조합 이름. 광땡 > 땡 > 특수 족보(알리·독사·구삥·장삥·장사·세륙) > 갑오 > 끗 > 망통 순으로 강해요." },
            { term: "끗", body: "두 장의 월 수를 더한 값의 일의 자리. 9끗은 갑오, 0끗은 망통이라고 불러요." },
            { term: "땡", body: "같은 월 두 장. 10월 두 장이 장땡, 1월 두 장이 삥땡." },
            { term: "광", body: "1월·3월·8월의 광(光) 카드. 광 두 장이면 광땡이에요." },
            { term: "띠 · 열끗", body: "화투 카드의 종류. 특수 패(암행어사·땡잡이·구사)는 정해진 종류의 카드로만 만들어져요." },
            { term: "삥", body: "판이 시작될 때 모두가 내는 기본 베팅. 테이블의 최소 베팅 금액과 같아요." },
            { term: "선", body: "이번 판의 기준 자리(딜러). 선 다음 사람부터 베팅을 시작하고, 매 판 시계 방향으로 넘어가요." },
            { term: "팟", body: "이번 판에 모인 판돈 전체. 승자가 가져가며, 소액의 수수료(레이크)가 빠집니다." },
            { term: "재경기", body: "멍텅구리 구사가 성립하면 판을 무효로 하고 낸 돈을 모두 돌려받아요." },
          ]}
        />
      ),
    },
  ],
};
