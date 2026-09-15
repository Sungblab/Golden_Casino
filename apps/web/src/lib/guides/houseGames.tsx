import { GuideActions, GuideHeading, GuideNote, GuideSteps, GuideTerms, type GameGuideContent } from "../../components/GameGuide";

/** Payout table rows shared by the house games. */
function PayoutTable({ rows }: { rows: Array<{ bet: string; pays: string; note?: string }> }) {
  return (
    <table className="guide-payouts">
      <thead><tr><th>베팅</th><th>배당</th><th>설명</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bet}><td>{row.bet}</td><td>{row.pays}</td><td>{row.note ?? ""}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export const baccaratGuide: GameGuideContent = {
  gameKey: "baccarat",
  title: "바카라",
  intro: "플레이어와 뱅커 중 카드 합이 9에 더 가까운 쪽을 맞히는 게임. 카드는 자동으로 뽑히고, 나는 어느 쪽이 이길지에만 베팅합니다.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (12초)", body: "아래 칩에서 금액을 고른 뒤 PLAYER · BANKER · TIE 등 원하는 칸을 누르세요. 여러 번 누르면 금액이 더해지고, 마감 전에는 되돌리기로 취소할 수 있어요." },
              { title: "카드 오픈", body: "플레이어와 뱅커가 각각 2장을 받습니다. 규칙에 따라 자동으로 3번째 카드를 받기도 해요 (내가 고를 건 없어요)." },
              { title: "정산", body: "합이 9에 가까운 쪽이 승리. 맞힌 베팅은 배당대로 돌려받고, 잔액에 바로 반영됩니다." },
            ]}
          />
          <GuideHeading>카드 점수 계산</GuideHeading>
          <GuideNote>A는 1점, 2~9는 숫자 그대로, 10·J·Q·K는 0점. 합이 10을 넘으면 일의 자리만 봅니다 (7+8 = 15 → 5점). 첫 2장의 합이 8·9면 "내추럴"로 바로 끝나요.</GuideNote>
          <GuideHeading>배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "PLAYER", pays: "1 : 1", note: "타이가 나오면 베팅금 반환" },
              { bet: "BANKER", pays: "0.95 : 1", note: "뱅커가 조금 더 자주 이겨서 5% 수수료가 붙어요. 타이면 반환" },
              { bet: "TIE", pays: "8 : 1", note: "양쪽 점수가 같을 때 (라이트닝 방은 5 : 1)" },
              { bet: "P PAIR / B PAIR", pays: "11 : 1", note: "그쪽 첫 2장의 숫자가 같으면 적중 (라이트닝 방은 9 : 1)" },
              { bet: "P BONUS / B BONUS", pays: "최대 30 : 1", note: "보너스 방 전용. 이긴 점수 차이가 클수록 배당이 커져요" },
            ]}
          />
          <GuideNote tone="red">라이트닝 바카라는 베팅마다 20% 수수료를 내는 대신, 무작위로 뽑힌 라이트닝 카드가 내 승리 카드에 포함되면 배당이 2~8배로 커집니다.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "내추럴", body: "첫 2장의 합이 8 또는 9. 3번째 카드 없이 바로 승부가 나요." },
            { term: "슈", body: "8덱(416장)을 섞어 넣은 카드 통. 남은 카드 수가 상단에 표시돼요." },
            { term: "빅로드", body: "최근 결과 기록표. 파란 원은 플레이어, 빨간 원은 뱅커 승리, 초록 선은 타이. 연속 승리는 세로로 이어져요." },
            { term: "되돌리기 / 반복", body: "베팅 마감 전 전체 취소, 그리고 직전 라운드와 똑같이 다시 베팅하는 버튼." },
            { term: "페어", body: "한쪽의 첫 2장 숫자가 같은 경우. 무늬는 상관없어요." },
          ]}
        />
      ),
    },
  ],
};

export const dragonTigerGuide: GameGuideContent = {
  gameKey: "dragon_tiger",
  title: "드래곤 타이거",
  intro: "드래곤과 타이거가 카드를 한 장씩 받아 더 높은 카드가 이깁니다. 가장 단순한 카드 게임이에요.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "칩을 고르고 베팅 (12초)", body: "DRAGON · TIGER · TIE · SUITED TIE 중 원하는 칸을 누르세요. 여러 칸에 동시에 걸 수도 있어요." },
              { title: "카드 오픈", body: "드래곤과 타이거가 각각 1장씩 받습니다." },
              { title: "정산", body: "숫자가 높은 쪽이 승리. A가 가장 낮고(1), K가 가장 높아요(13). 무늬는 승부에 상관없어요." },
            ]}
          />
          <GuideHeading>배당</GuideHeading>
          <PayoutTable
            rows={[
              { bet: "DRAGON / TIGER", pays: "1 : 1", note: "타이가 나오면 베팅금의 절반만 돌려받아요" },
              { bet: "TIE", pays: "11 : 1", note: "두 카드의 숫자가 같을 때" },
              { bet: "SUITED TIE", pays: "50 : 1", note: "숫자와 무늬가 모두 같을 때. 최대 베팅 한도가 따로 있어요" },
            ]}
          />
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "타이", body: "드래곤과 타이거의 숫자가 같은 경우." },
            { term: "수티드 타이", body: "숫자뿐 아니라 무늬까지 같은 타이. 드물어서 배당이 커요." },
            { term: "로드맵", body: "최근 결과 기록. D는 드래곤, T는 타이거 승리." },
          ]}
        />
      ),
    },
  ],
};

export const blackjackGuide: GameGuideContent = {
  gameKey: "blackjack",
  title: "블랙잭",
  intro: "카드 합을 21에 최대한 가깝게 만들되 넘기지 않으면서 딜러보다 높으면 이기는 게임. 이번엔 내가 직접 카드를 더 받을지 결정해요.",
  sections: [
    {
      id: "howto",
      title: "게임 방법",
      content: (
        <>
          <GuideSteps
            steps={[
              { title: "자리에 앉고 베팅 (12초)", body: "빈 자리를 눌러 앉은 뒤 칩을 고르고 베팅 버튼을 누르세요. 자리가 없으면 다른 플레이어의 자리를 눌러 따라 베팅(Bet Behind)할 수 있어요." },
              { title: "카드 2장씩", body: "나와 딜러가 2장씩 받습니다. 딜러는 한 장만 보여줘요. 딜러 카드가 A면 보험을 살지 물어봐요." },
              { title: "내 차례", body: "합을 보고 히트(한 장 더) · 스탠드(멈춤) · 더블 · 스플릿 · 서렌더 중 고르세요. 21을 넘으면(버스트) 바로 패배예요." },
              { title: "딜러 차례", body: "딜러는 합이 17 이상이 될 때까지 자동으로 카드를 받아요 (17이면 멈춤)." },
              { title: "정산", body: "딜러가 버스트하거나 내 합이 더 높으면 승리(1:1). 첫 2장으로 21이면 블랙잭(3:2). 같으면 푸시로 베팅금 반환." },
            ]}
          />
          <GuideHeading>카드 점수 계산</GuideHeading>
          <GuideNote>2~10은 숫자 그대로, J·Q·K는 10점, A는 1점 또는 11점 중 유리한 쪽. 예: A+7 = 18 (소프트 18), A+7+9 = 17.</GuideNote>
          <GuideHeading>버튼 설명</GuideHeading>
          <GuideActions
            actions={[
              { label: "히트", tone: "green", body: "카드를 한 장 더 받습니다. 합이 낮을 때." },
              { label: "스탠드", tone: "gold", body: "더 받지 않고 멈춥니다. 딜러 차례로 넘어가요." },
              { label: "더블", tone: "blue", body: "베팅을 2배로 올리고 딱 한 장만 더 받습니다. 첫 2장일 때만 가능." },
              { label: "스플릿", tone: "purple", body: "같은 숫자 2장을 두 패로 나눠 각각 플레이합니다. 추가 베팅이 필요해요 (최대 4패)." },
              { label: "서렌더", tone: "red", body: "첫 2장 상태에서 포기하고 베팅금의 절반을 돌려받습니다." },
              { label: "보험", tone: "gold", body: "딜러 오픈 카드가 A일 때, 베팅의 절반으로 딜러 블랙잭에 대비합니다 (적중 시 2:1)." },
            ]}
          />
          <GuideNote tone="red">라이트닝 블랙잭은 첫 베팅에 100% 수수료를 내는 대신, 이기면 다음 라운드 이익에 2~25배 배수가 적용돼요.</GuideNote>
        </>
      ),
    },
    {
      id: "terms",
      title: "용어",
      content: (
        <GuideTerms
          terms={[
            { term: "블랙잭", body: "첫 2장이 A + 10점 카드로 21. 3:2로 배당받아요 (스플릿 후 21은 일반 21)." },
            { term: "버스트", body: "합이 21을 넘는 것. 넘는 순간 그 패는 패배." },
            { term: "푸시", body: "딜러와 합이 같은 경우. 베팅금을 돌려받아요." },
            { term: "소프트 핸드", body: "A를 11로 세고 있는 패. 한 장 더 받아도 버스트되지 않아요." },
            { term: "따라 베팅 (Bet Behind)", body: "앉은 자리가 없어도 다른 플레이어의 패에 함께 베팅하는 것. 그 사람의 결과를 그대로 따라가요." },
          ]}
        />
      ),
    },
  ],
};
