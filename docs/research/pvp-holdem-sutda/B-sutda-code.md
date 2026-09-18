# B. 섯다 현재 구현 인벤토리

- 대상: `C:\Users\Sungbin\Documents\GitHub\Golden_Casino` 작업 트리 (커밋 `051451d` + 미커밋 변경). 미커밋 변경 중 섯다 관련은 `apps/web/src/styles/table-sutda.css`의 폰트 크기·색 토큰 정리뿐이며(`git diff`: 9px→11px, 7px→12.5px, 색상 토큰화) 기능 변화는 없다.
- 줄번호 표기: `파일경로:줄`. 추측은 "(추정)".
- 주의: `apps/api/src/games/rooms/holdem-room-manager.ts`는 이 보고서 작성 도중 다른 세션이 `leave()`에 3줄(172-174, 이탈 시 턴 즉시 해제)을 추가했다. 본문 홀덤 인용은 그 이전 상태 기준이므로 **171행 이후의 홀덤 줄번호는 +3 오프셋**이 있을 수 있다(섯다 파일은 변경 없음).
- 한국 표준 규칙의 근거: 한게임 섯다 게임가이드(베팅), 한게임 LA섯다 베팅 가이드, 구사/멍텅구리 구사 해설 페이지, 브런치 섯다 규칙 정리, 나무위키 피망 섯다 — 문서 말미 "참고 출처".

## 요약 (한 줄)

섯다는 **홀덤을 상속하지 않는 79줄짜리 독립 액터**로, 2장 섯다·6석·"다이/체크/콜/하프" 4액션·1인당 판당 총액 캡만 갖춘 최소 구현이다. 족보·특수패 판정(`game-core/sutda.ts`)은 비교적 충실하지만 **일반 구사(4띠·9띠) 재경기 없음, 멍텅구리 구사가 장땡에 막힘, 재경기가 '판돈 이월+재딜'이 아니라 '팟 균등 분할 후 판 종료'**로 구현되어 있고, 따당·쿼터·풀·자동콜/다이·타임뱅크·올인/사이드팟·6매·전적·위너피드·게임히스토리 연동이 전부 빠져 있다. 서버에는 대기 중 이탈 좌석 미회수로 인한 테이블 잠김과 `launch()` 무한 재시도 루프라는 심각한 버그 후보 2건이 있다.

---

## B1. 게임 규칙 (서버 기준)

### B1-1. 변형·패

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 변형 | **2장 섯다 고정**. 스트리트 enum이 `first / final / showdown` 3개뿐 | `packages/contracts/src/index.ts:524`, `apps/api/src/games/rooms/sutda-room-manager.ts:67-70` |
| 3장/6매 섯다 | 없음 (옵션·스키마·UI 모두 없음) | `packages/contracts/src/index.ts:526` (액션 enum에 카드 선택 없음), `:541` (`cards` max 2) |
| 화투 패 수 | 20장 (1~10월 × 2). 1·3·8월은 광+(띠 또는 열끗), 나머지 띠+열끗. 8월은 광+열끗 | `packages/game-core/src/sutda.ts:18-25` |
| 셔플 | Fisher–Yates + Web Crypto `secureRandomInt` (클라이언트 번들 호환 목적) | `packages/game-core/src/sutda.ts:2-4, 27-34` |
| 카드 스키마 | `{id, month(1~10), kind(hikari/tanzaku/tane/kasu)}` — `kasu`는 20장 덱에서 쓰이지 않는 잉여 값 | `packages/contracts/src/index.ts:515-522` |

### B1-2. 좌석·판돈·방 등급

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 좌석 수 | 6석 (`SEATS = 6`), 스냅샷 `seats.length(6)` | `sutda-room-manager.ts:13`, `contracts/src/index.ts:559` |
| 방 등급 (시드) | Rookie 1/100, Standard 10/1,000, High Roller 50/5,000 (`min_bet`/`max_bet`, `side_bet_max` null). DB `game_rooms`에서 `game_type='sutda'`로 로드 | `apps/api/src/database/seed.ts:29-31`, `sutda-room-manager.ts:79` |
| `min_bet`의 의미 | **삥(앤티)**: 판 시작 시 참가자 전원이 `min_bet`을 자동 납부하고, 그 액수가 첫 스트리트의 `currentBet`이 됨 | `sutda-room-manager.ts:67` (`contribute(number - 1, this.room.min_bet)`, `this.currentBet = this.room.min_bet`) |
| `max_bet`의 의미 | **1인당 1판 총 기여 상한** (`seat.total + coins > max_bet` → `TABLE_LIMIT_REACHED`). 한게임의 "한 판 1인 최대 베팅 금액"과 같은 개념 | `sutda-room-manager.ts:53` |
| 착석 조건 | 지갑 잔액 ≥ `min_bet × 2`. 판 진행 중에도 착석 가능(카드 없는 좌석으로 대기) | `sutda-room-manager.ts:26` |
| 핸드 시작 시 잔액 재검사 | 잔액 < `min_bet × 2`면 `sittingOut`으로 빼고, 그 좌석은 판이 끝난 뒤 `reset()`에서 강제 퇴석(알림 없음) | `sutda-room-manager.ts:67, 60` |
| 바이인/테이블 스택 | **없음**. 좌석의 `stack`은 사용자의 **지갑 전체 잔액**을 매 스냅샷마다 DB에서 읽어 전원에게 노출 | `sutda-room-manager.ts:54` (`stack: await walletService.getUserBalance(seat.userId)`) |

### B1-3. 핸드 시작·딜 순서·선(先)

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 시작 조건 | `WAITING` && 착석 ≥ 2 && **착석자 전원 준비(ready)** && 미일시정지 && 사이클 미실행 | `sutda-room-manager.ts:58-59` |
| ready 지속성 | **매 판 종료 시 `ready.clear()`** → 매 판 전원이 다시 "준비 완료"를 눌러야 함 (홀덤은 sticky) | `sutda-room-manager.ts:60` vs `holdem-room-manager.ts:73-76, 494-496` |
| 선 결정 | 직전 선의 **다음 착석자(시계 방향)**가 선. 첫 판은 가장 낮은 번호 좌석부터 | `sutda-room-manager.ts:66-67` (`order(this.dealer + 1)`, `this.dealer = order[0]`) |
| 첫 베팅자 | 두 스트리트 모두 **선 다음 사람(`order[1]`)** 부터. 즉 선은 마지막에 행동 | `sutda-room-manager.ts:67, 70` |
| 판 번호·라운드 레코드 | `game_rounds`에 `phase='DEALING', rules_version='sutda-v1'` INSERT. 중간 phase는 DB에 갱신하지 않고 마지막에 `RESULT`만 기록 | `sutda-room-manager.ts:67, 76` |
| 스트리트 구성 | 앤티 → 1장 딜(0.9초) → 1차 베팅 → (생존 ≥2) 2장째 딜(0.9초) + `recordCards` → 2차 베팅 → 쇼다운 → RESULT 5초 → WAITING | `sutda-room-manager.ts:13, 67-70` |
| 첫 스트리트 시작 상태 | 앤티가 `seat.street`에도 합산되어 전원 `toCall = 0` → **1차 베팅은 전원 체크로 넘어갈 수 있음** | `sutda-room-manager.ts:53, 67` |
| 2차 스트리트 | `seat.street = 0, currentBet = 0, acted.clear()` 후 시작 | `sutda-room-manager.ts:70` |
| 판 사이 휴식 | 없음. RESULT 5초 후 즉시 `WAITING`(카운트다운 없음, `phaseEndsAt=null`) | `sutda-room-manager.ts:70, 60` (홀덤은 `HAND_BREAK_MS = 6_000` `holdem-room-manager.ts:54, 588-600`) |

### B1-4. 베팅 액션

| 액션 | 존재 | 규칙 | 근거 |
| --- | --- | --- | --- |
| 다이(`die`) | 있음 | 즉시 폴드, `sutda_contributions.folded=true`. **마지막 생존자도 다이 가능(가드 없음)** | `sutda-room-manager.ts:49` |
| 체크(`check`) | 있음 | `toCall > 0`이면 `MUST_CALL_OR_DIE` | `sutda-room-manager.ts:49` |
| 콜(`call`) | 있음 | 잔액 < `toCall`이면 `INSUFFICIENT_BALANCE` (올인 없음) | `sutda-room-manager.ts:49` |
| 하프(`half`) | 있음 | `raiseBy = min(max(min_bet, round(pot/2)), max_bet − seat.total − toCall)`; 0 이하면 `TABLE_LIMIT_REACHED`; 납부액 = `toCall + raiseBy`; `currentBet = seat.street + 납부액`; `acted = {나}` | `sutda-room-manager.ts:49-52` |
| 삥(액션) | 없음 | 앤티로만 자동 납부. "기본 머니만큼 베팅"하는 액션은 없음 | `contracts/src/index.ts:526` |
| 따당·쿼터·풀(맥스) | 없음 | — | `contracts/src/index.ts:526` |
| 레이즈 횟수 제한 | 없음 | 캡(`max_bet`)에 닿을 때까지 무제한 재레이즈 | `sutda-room-manager.ts:52-53` |
| 111/222/333 베팅룰 | 없음 | — | — |

- 하프 산정 근거: 코드 주석이 "홀덤 `half` 프리셋의 팟 절반 관행"을 그대로 따른다고 명시 (`sutda-room-manager.ts:49-51`). 한게임 정의("앞사람 베팅을 받고, 이를 포함한 전체 판돈의 1/2 추가")와 계산상 동일하다.
- 클라이언트는 서버와 같은 식으로 하프 금액을 미리 계산해 버튼에 표시한다 (`apps/web/src/pages/SutdaRoomPage.tsx:123-127`).

### B1-5. 올인·사이드팟·판돈 상한

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 올인 | **없음**. 잔액이 콜 금액에 못 미치면 다이만 가능. 도움말도 그렇게 안내 | `sutda-room-manager.ts:49`, `apps/web/src/lib/guides/sutda.tsx:133` |
| 사이드팟 | 없음. 팟은 단일 숫자(`pot.amount` = 좌석 total 합) | `contracts/src/index.ts:528, 558`, `sutda-room-manager.ts:54` |
| 판돈 상한 | 1인당 `max_bet`이므로 팟 최대 = `max_bet × 참가자 수` | `sutda-room-manager.ts:53` |

### B1-6. 족보 서열 (코드 rank 표)

`packages/game-core/src/sutda.ts:39-61` `evaluateSutdaHand`:

| 순위 | 족보 | rank | 판정 조건 | 근거 |
| --- | --- | --- | --- | --- |
| 1 | 38광땡 | 1000 | 3광+8광 | `:44` |
| 2 | 13광땡 / 18광땡 (**동급**) | 990 | 1광+3광, 1광+8광 | `:45` |
| 3 | 장땡(10땡) ~ 삥땡(1땡) | 910~901 | 같은 월 두 장 (`900 + month`) | `:46` |
| 4 | 알리(1-2) | 800 | 월 조합만 (종류 무관) | `:55-58` |
| 5 | 독사(1-4) | 799 | | |
| 6 | 구삥(1-9) | 798 | | |
| 7 | 장삥(1-10) | 797 | | |
| 8 | 장사(4-10) | 796 | | |
| 9 | 세륙(4-6) | 795 | | |
| 10 | 갑오(9끗) | 700 | 합의 일의 자리 9 | `:59-60` |
| 11 | 8끗 ~ 1끗 | 8~1 | 합의 일의 자리 | `:59-60` |
| 12 | 망통 | 0 | 합의 일의 자리 0 | `:60` |

- 표준(38 > 18 = 13 동급)과 일치한다 (브런치 정리·한게임 도움말 기준). 참고 데이터 `SUTDA_RANKINGS`(29행)도 같은 순서를 생성하고 테스트가 정렬·라벨 유일성을 검증 (`sutda.ts:126-157`, `sutda.test.ts:72-90`).
- 특수패 판정은 일반 족보보다 **먼저** 검사된다 (`:52-54`가 `:55-60`보다 앞). 예: 3광+7열끗은 망통이 아니라 먼저 `땡잡이`로 라벨된다.

### B1-7. 특수패

| 특수패 | 조합 | 캐치 조건 | 폴백 | 근거 |
| --- | --- | --- | --- | --- |
| 땡잡이 | 3광 + 7열끗 | 테이블 **최고 패**가 1땡~9땡(rank 901~909)일 때 그 땡을 잡음. 장땡·광땡은 못 잡음 | 망통(rank 0) | `sutda.ts:52, 73-77` |
| 암행어사 | 4열끗 + 7열끗 | 최고 패가 13·18광땡(990)일 때 잡음. 38광땡은 못 잡음 | 1끗(rank 1) | `sutda.ts:54, 70-72` |
| 멍텅구리 구사 | 4열끗 + 9열끗 | 최고 패가 **장땡 미만(rank ≤ 909)** 이면 `redeal: true` | 3끗(rank 3) | `sutda.ts:53, 68-69` |
| 구사(4띠 + 9띠) | — | **미구현** — 월 조합 4-9가 named 목록에 없어 13→3끗으로만 처리 | — | `sutda.ts:53` (열끗 조합만), `:55` |

- 우선순위: `redeal(멍텅구리)` → `암행어사` → `땡잡이` → 최고 rank 동점자 전원 (`sutda.ts:64-79`).
- 판정 우선순위 상 문제 (추정): 암행어사·땡잡이가 둘 다 있고 최고 패가 13광땡이면 암행어사가 이기고, 최고 패가 9땡이면 땡잡이가 이기며, 최고 패가 장땡이면 둘 다 폴백 → 정상. 그러나 **암행어사와 13광땡, 그리고 다른 사람의 38광땡이 같이 있으면** `best = 1000` → 암행어사 분기(`best === 990`) 불발 → 38광땡 승. 표준과 일치.
- 재경기 처리 (`sutda-room-manager.ts:73-76`): `redeal`이면 **활성(미폴드) 전원을 winnerIds로 넣고 `settle(..., takeRake=false)`** → 팟(다이한 사람의 앤티 포함)을 **활성 인원으로 균등 분할**하고 판을 **종료**한다. 새 패를 돌리지 않으며 판돈 이월도 없다. `handLabel = "멍텅구리 구사 · 재경기"`.
  - 표준: "기존에 걸려 있던 판돈을 그대로 둔 상태에서 새로운 패를 돌려 승부"(브런치), 포기자는 "깔린 돈의 절반을 내야 재대결에 낄 수" 있음(playcard) — **판돈 이월·재딜**이 표준.
  - 멍텅구리 구사 표준: "광땡을 제외한 모든 패와 재경기"(브런치), "땡까지 재경기, 장땡은 지역에 따라 제외"(playcard). 코드는 **장땡이 있으면 재경기 불성립**으로 고정 (`sutda.ts:69` `best <= 909`).
- 단독 생존(상대 전원 다이) 시에는 `resolveSutdaWinners`를 우회해 그냥 승리 처리(멍텅구리 구사 단독 생존 시 재경기 방지, 레이크 정상 부과) (`sutda-room-manager.ts:73-76`).

### B1-8. 무승부·승자 결정·분배

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 같은 rank | 동점자 전원 승자 → `(총액 − 레이크) / n` 균등, 나머지 코인은 첫 번째 승자에게 | `sutda.ts:78`, `apps/api/src/games/sutda/sutda-service.ts:33-35` |
| 13광땡 vs 18광땡 | 동급(990)이므로 분할 | `sutda.ts:45` |
| 특수패 캐치 다수 | 암행어사 여러 명 / 땡잡이 여러 명이면 그들끼리 분할 | `sutda.ts:72, 77` |
| 재경기 시 분배 | 위 B1-7: 활성 전원 균등 분할, 레이크 0 | `sutda-room-manager.ts:76`, `sutda-service.ts:32` |
| 정산 라벨 | `won = takeRake && winner` → win; 아니면 `payout === amount ? push : lose`. 재경기에서 균등 분할 금액이 자기 기여액과 다르면(대개 다름) **lose로 기록** | `sutda-service.ts:52-53` |

### B1-9. 쇼다운·카드 공개·결과 단계

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 공개 범위 | `street === "showdown"`일 때 **폴드하지 않은** 좌석의 카드만 전원에게 공개. 다이한 사람 카드는 끝까지 비공개 | `sutda-room-manager.ts:54` (`cards: mine || (reveal && !seat.folded)`) |
| 족보 라벨 | 2장 보유 && (본인 또는 쇼다운)일 때만 `handLabel` 전송 → 상대 족보 사전 유출 없음 | `sutda-room-manager.ts:54` |
| 단독 생존 | 쇼다운 단계로 가되 `handLabel = "상대 전원 다이"`, 승자 카드는 `reveal`이므로 공개됨(포커의 "머킹" 없음) | `sutda-room-manager.ts:54, 76` |
| 결과 단계 길이 | `RESULT_MS = 5_000` (첫 스트리트 조기 종료도 동일) | `sutda-room-manager.ts:13, 67-70` |
| 결과 저장 | `game_rounds.result_data = {winners, redeal}`, `phase='RESULT'`, `settled_at` | `sutda-room-manager.ts:76` |

### B1-10. 레이크·수수료

- 홀덤 서비스의 `rakeFor`를 그대로 import: **팟의 5%, 상한 = `max_bet`의 3%** (Rookie 3코인, Standard 30, High 150) (`sutda-service.ts:3, 32`, `apps/api/src/games/holdem/holdem-service.ts:13-18`, 테스트 `holdem-service.test.ts:15-23`).
- 상대 전원 다이(기권승)에도 레이크 부과, 재경기(멍텅구리)에만 면제 (`sutda-room-manager.ts:76` `!result.redeal`).
- 웨이저링(롤링) 크레딧은 각자의 **레이크 분담분만** 인정 — 담합 세탁 방지 목적 (`sutda-service.ts:55-61`, 소스 타입 `sutda_rake` `apps/api/src/wallet/wagering-service.ts:5`).
- 도움말에는 "소액의 수수료(레이크)"라고만 적혀 있고 비율·상한은 안내하지 않음 (`apps/web/src/lib/guides/sutda.tsx:150`).

### B1-11. 타이머·타임아웃·이탈·복구

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 턴 타이머 | 20초 고정(`ACTION_MS`), 타임뱅크·연장 없음. 클라이언트도 `ACTION_SECONDS = 20`을 별도 하드코딩 | `sutda-room-manager.ts:13, 71`, `SutdaRoomPage.tsx:19` |
| 타임아웃 자동 처리 | `currentBet > seat.street`면 **자동 다이**, 아니면 **자동 체크** | `sutda-room-manager.ts:71` |
| 자동 콜/자동 다이 예약 | 없음 | — |
| 판 중 자리 비우기 | 카드 있고 미폴드면 즉시 다이(+턴 해제) 후 `sittingOut`; 좌석은 판 종료 `reset()`에서 회수. 클라이언트가 confirm으로 경고 | `sutda-room-manager.ts:27-46`, `SutdaRoomPage.tsx:144-148` |
| 접속 끊김(`leave`) | 마지막 소켓이 끊기면 `participants` 제거 + `sittingOut.add`. **좌석·ready는 그대로**, 폴드도 안 함(턴이 오면 20초 뒤 자동 처리), 스냅샷 재전송도 없음 | `sutda-room-manager.ts:25` |
| 재접속(`join`) | `sittingOut.delete` → 좌석 그대로 복귀 (판 중이면 카드도 그대로) | `sutda-room-manager.ts:24` |
| 대기 중(WAITING) 이탈 | 좌석이 회수되지 않음 → B5 버그 후보 #1 | `sutda-room-manager.ts:25, 58-60` |
| 판 진행 중 오류 | `play()` 예외 → `refundRound`(전액 환불, `ABORTED`) → `reset()` → 재`launch()`. 홀덤과 달리 사용자 알림(`notification`) 없음 | `sutda-room-manager.ts:59` vs `holdem-room-manager.ts:463-471` |
| 프로세스 재시작 | 부팅 시 `rules_version='sutda-v1'` && `settled_at IS NULL`인 라운드를 **무조건 환불**. 두 장 다 받은 뒤 중단이어도 저장된 카드(`sutda_contributions.cards`)로 정산하지 않음(홀덤은 리버까지면 정산) | `sutda-service.ts:72-76` vs `holdem-service.ts:222-265`; 초기화 순서 `apps/api/src/main.ts:1200-1201` |
| 일시정지 | 관리자 pause는 다음 판 시작만 막음(진행 중 판은 계속) | `sutda-room-manager.ts:23, 59`, `main.ts:75, 82` |

---

## B2. 서버 아키텍처·원장

### B2-1. 홀덤과 공유하는 코드 vs 섯다 고유 코드

| 구분 | 내용 | 근거 |
| --- | --- | --- |
| 상속 | **없음**. `SutdaRoomActor`/`SutdaRoomManager`는 독립 클래스이며 `room-manager.ts`(바카라 액터)와도 무관 | `sutda-room-manager.ts:16, 79`; `apps/api/src/games/rooms/room-manager.ts:71, 392` |
| 홀덤에서 가져오는 것 | `rakeFor` 함수 하나 | `sutda-service.ts:3` |
| 복제(copy-paste)된 구조 | 참가자/소켓 맵, `sittingOut`/`ready`, `sequence`, 턴 대기 `turnResolve`, `requests` 멱등 세트, `launch/reset`, 베팅 루프 종료 판정, 잔액 기준 착석·시작 검사 — 홀덤 액터의 축약판을 한 줄 압축 스타일로 재작성 | `sutda-room-manager.ts:16-72` ↔ `holdem-room-manager.ts:63-102, 141-251, 436-517, 642-697` |
| 홀덤에 있고 섯다에 없는 것 | 올인/`minRaise`/사이드팟(`buildHoldemPots`), 위너 피드(`room.winners`), 판 사이 휴식 카운트다운, 대기 중 이탈 좌석 즉시 회수, 오류 시 사용자 알림, 저장된 보드로 재시작 정산, `notification` 이벤트 | `holdem-room-manager.ts:43-47, 160-182, 322-326, 390-399, 412-427, 463-471, 588-600`; `holdem-service.ts:222-265` |
| 공용 인프라 | `walletService`(잔액·계정·복식 원장), `wageringService`, `pool`, `game_rounds` 테이블, 소켓 `authorizeCommand`, 관리자 pause/broadcast/overview 체인 | `sutda-room-manager.ts:5-7`, `main.ts:61-82, 135, 247, 951-978` |

### B2-2. 팟 에스크로 → 정산 → 레이크 흐름

```
착석/앤티/콜/하프  : 사용자 계정 −amount  / 방 예치 계정 +amount        (SUTDA_CONTRIBUTE, key sutda-contribute:{roundId}:{userId}:{누적total})
쇼다운 정산        : 방 예치 계정 −총액   / 하우스 +rake / 승자들 +payout (SUTDA_SETTLED, key sutda-settle:{roundId})
처리 실패·재시작   : 방 예치 계정 −기여액 / 사용자 +기여액              (SUTDA_REFUNDED, key sutda-refund:{roundId}:{userId})
```

- 기여 멱등키는 "직전 누적액"을 포함해 재전송을 no-op으로 만든다 (`sutda-room-manager.ts:53`, `sutda-service.ts:11-22`). 각 기여는 자체 트랜잭션(`BEGIN/COMMIT`)이라 판 단위 원자성은 없고, `sutda_contributions`가 `(round_id,user_id)` 단위로 누적 upsert된다 (`sutda-service.ts:17-21`, `apps/api/src/database/schema.ts:284-300`).
- `postTransaction`이 잔액 부족을 원장 수준에서 막고(`apps/api/src/wallet/wallet-service.ts:182-228`), 엔트리 합계 0을 `assertBalancedEntries`로 검증한다.
- 정산은 한 트랜잭션에서 원장 기록 + `sutda_contributions.payout_minor/outcome/settled_at` 갱신 + 웨이저링 크레딧 (`sutda-service.ts:29-67`).
- `game_rounds.one_active_round_per_room` 부분 유니크 인덱스 때문에 미정산 라운드가 남으면 그 방의 다음 판 INSERT가 실패한다 — 그래서 부팅 시 환불이 필수 (`schema.ts:236`, `sutda-service.ts:70, 72-76`).
- `docs/architecture.md`는 홀덤 PvP 예외(`:67-79`)만 설명하고 **섯다는 어디에도 언급이 없다** (다이어그램 `:21-23`도 Hold'em만).

### B2-3. 스냅샷 내용과 비공개 정보

`sutda-room-manager.ts:54` `snapshot(userId)` — 참가자마다 개별 생성(`emit()` `:55`):

| 필드 | 공개 범위 | 비고 |
| --- | --- | --- |
| `seats[].cards` | 본인 / 쇼다운 시 미폴드 좌석 | 유출 없음 |
| `seats[].cardCount` | 전원 | 뒷면 개수 표시용 (`contracts:542-545`) |
| `seats[].handLabel` | 본인(2장부터) / 쇼다운 | 유출 없음 |
| `seats[].stack` | 전원 | **지갑 전액** 노출 (테이블 스택 개념 없음) |
| `seats[].streetContributed/totalContributed/folded/sittingOut/isDealer/isTurn/ready` | 전원 | |
| `toCall`, `mySeatNumber`, `walletBalance` | 본인 기준 | |
| `pot.amount`, `street`, `actingSeat`(PLAYER_TURN일 때만), `lastWinners`, `phaseEndsAt`, `sequence` | 전원 | |

- 성능: 스냅샷 1회당 좌석 수+1번의 `getUserBalance` DB 조회 × 참가자 수 (관전자 포함) — 매 액션/phase 전환마다 반복 (`:54-55`, `wallet-service.ts:18-21`).
- 카드는 2장째를 받을 때 DB(`sutda_contributions.cards`)에 저장된다 (`sutda-room-manager.ts:70`, `sutda-service.ts:23`). 첫 장은 저장하지 않으므로 1차 베팅 중 재시작하면 어차피 복구 불가 — 하지만 2장 저장 후 중단도 정산이 아닌 환불로 처리(B1-11).

### B2-4. 상태머신

```
WAITING ──(착석≥2 & 전원 ready)──▶ DEALING(0.9s, street=first)
   ▲                                    │
   │                                    ▼
   │                          PLAYER_TURN ×N (20s/턴)  ──(생존≤1)──▶ RESULT(5s) ─┐
   │                                    │                                        │
   │                                    ▼                                        │
   │                          DEALING(0.9s, street=final)                        │
   │                                    │                                        │
   │                                    ▼                                        │
   │                          PLAYER_TURN ×N ──▶ street=showdown ──▶ RESULT(5s) ─┤
   └────────────────────────────── reset() (ready.clear, sittingOut 좌석 회수) ◀─┘
```

- `RoomPhase` 공용 enum에서 `WAITING/DEALING/PLAYER_TURN/RESULT`만 사용, `SETTLING/BETTING/LOCKED`는 미사용 (`contracts:15-27`, `sutda-room-manager.ts:67-76`).
- 클라이언트의 단계 바는 `street × phase` 조합으로 5단계(첫 패/1차 베팅/둘째 패/2차 베팅/승부)를 유도 (`SutdaRoomPage.tsx:24-25, 398-404`).

---

## B3. 클라이언트 UX 인벤토리

### B3-1. 레이아웃

- 페이지: `apps/web/src/pages/SutdaRoomPage.tsx` (435줄). 홀덤 v4 2단 셸 `room-shell holdem-room-shell sutda-shell`을 그대로 사용: 왼쪽 테이블(`ot-stage > ot-felt holdem-felt sutda-felt > holdem-table`), 오른쪽 액션 레일(`aside.holdem-rail-v4`) (`:163-168, 224`).
- 레일 폭 232px(데스크톱), 150px(가로 폰) (`apps/web/src/styles/table-holdem.css:22-29, 359-367`). 테이블 가죽 범퍼·펠트·베팅 라인·네임플레이트 모두 `table-holdem.css:244-349`; 섯다는 펠트 색만 덧씌움 (`apps/web/src/styles/table-sutda.css:27-31`).
- 좌석 배치: 단위원 각도 `[90,150,210,270,330,30]`, 내 자리가 항상 아래(90°)로 회전 (`SutdaRoomPage.tsx:23, 339-342`); 반지름은 CSS 변수 `--seat-rx/ry` (`apps/web/src/styles/table-pvp.css:18-22`).
- 펠트 위 요소: 덱(`.sutda-deck`, 딜 애니 원점 `data-deck-shoe`), 팟, 스트리트 라벨("1차 베팅 · 첫 패"/"2차 베팅 · 둘째 패"), 직전 승자 pill, 내 턴 타이머 링, 미착석 시 "빈 자리를 눌러 앉으세요" 프롬프트, 오류 메시지 (`SutdaRoomPage.tsx:173-221`).
- 브랜드 마킹 텍스트 "사인방 섯다" (`:179`).

### B3-2. 액션 버튼·프리셋

- 내 턴에만 3버튼: **다이(포기하기, red) / 체크(그냥 넘기기, gold) 또는 콜 N(따라가기, blue) / 하프 N(올리기, green)** — `ActionButton`(용어 + 한 줄 설명) (`SutdaRoomPage.tsx:280-293`, `apps/web/src/components/PvpBits.tsx:44-51`).
- 하프 버튼은 총 납부액을 표시하고 `title`에 "콜 X + 올리기 Y"를 보여줌; 한도 도달/잔액 부족이면 비활성 + 힌트 (`:126-129, 285-292`).
- 프리셋(삥/따당/쿼터/풀), 금액 스테퍼, 올인 버튼 **없음** (홀덤 페이지에는 5개 프리셋 존재 `apps/web/src/pages/HoldemRoomPage.tsx:204-211`).
- 턴 스트립 "내 차례예요" + 남은 초 + 진행 바, 5초 이하 `is-closing` 붉은 톤 (`:133, 272-279`, `table-pvp.css:78-99`).
- 준비 독: "N/M명 준비 완료", 준비 완료/취소 토글(블랙잭 클래스 `bj-act-hit/surrender` 재사용), 안내 문구 (`:305-315`, `apps/web/src/styles.css:4309-4321`).
- 레일 푸터: 족보표(도움말 rankings 탭 열기) / 자리 비우기 / 채팅 토글 (`:323-331`).

### B3-3. 내 족보 패널

- `readSutdaHand(mine.cards)` (`apps/web/src/lib/sutdaHandRead.ts:43-83`):
  - 1장: "첫 패 3월 광" + "둘째 패를 받으면 족보가 정해져요" + **노려볼 패 상위 4개**(라벨·티어·필요 월) (`:45-59`, `game-core/sutda.ts:223-233`).
  - 2장: 족보 라벨, 카드 설명("3월 광 + 8월 광"), 5단 강도 미터(광땡 5 "최강" … 망통 1 "가장 약함") (`:34-41`), "가능한 189개 패 중 N개보다 강해요 (같은 패 M개)" (`:78`, `game-core/sutda.ts:198-208`), 특수패 한 줄 효과 (`:64-70`).
- 패널 헤더 "내 족보 / 나만 보여요", 하단 "족보표 전체 보기" 링크 (`SutdaRoomPage.tsx:229-262`). 미완성 상태는 `is-hint`로 흐리게 (`:230`, `table-holdem.css:167-171`).
- 강도 계산은 특수패의 캐치 효과를 제외한 폴백 rank 기준 (`game-core/sutda.ts:193-197`).

### B3-4. 상대 좌석·선 배지·타이머·결과

- 상대 좌석: `cardCount`만큼 뒷면(`HwatuCard hidden`), 쇼다운엔 앞면; 내 좌석은 항상 앞면 (`:356-362`). 상태 pill: "다이", "WIN +N", 쇼다운 족보 (`:372-376`).
- 선 배지: `isDealer`면 "선" pill (`:365`, `table-pvp.css:139-140`), 준비 점(`holdem-ready-dot`), 닉네임(내 자리는 "나"), 잔액(지갑 전액), 베팅 칩 스택(`ChipStack`) (`:363-371`).
- 타이머: 펠트 중앙 SVG 링(내 턴에만) + 레일 스트립; 세로 모드에선 링 숨김 (`:208-213`, `table-pvp.css:225`).
- 결과: `RoundResultNotice` 4.2초 — 승리 "족보 승리 +N", 패배 "OOO님의 족보에 패배 −내 기여액", 재경기 분기 "재경기 · 베팅금 반환"(도달 불가, B5 #4) (`:84-109`). 승자 pill은 다음 판 시작까지 유지 (`:185-193`, 서버 `lastWinners` `:54`).
- 상단 헤더(`GameShell`): 방 이름, "삥 N · 최대 M · 2–6인 PvP", 단계 라벨, 초, 잔액, 전체화면, 도움말 버튼 (`:150-162`, `apps/web/src/components/GameShell.tsx:88-100`).

### B3-5. 화투 렌더링·애니메이션·사운드

| 항목 | 현재 구현 | 근거 |
| --- | --- | --- |
| 카드 컴포넌트 | `HwatuCard`: `<img src="/cards/hwatu/Hwatu_{Month}_{Kind}.png">` + 좌상단 월 숫자 배지. 뒷면은 `span.hwatu-back` | `apps/web/src/components/HwatuCard.tsx:3-15` |
| 이미지 자산 | 48장 화투 PNG 전체 + `back.svg`(붉은 격자). 20장 덱에 필요한 파일은 모두 존재(1·3월 광/띠, 8월 광/열끗, 2·4·5·6·7·9·10월 띠/열끗) | `apps/web/public/cards/hwatu/` |
| 크기 | 기본 53×82 → 상대 34×53, 내 좌석 46×71, 레일 미니 22×34, 가로 폰 24×37/31×48, 도움말 30×47 | `styles.css:4441`, `table-sutda.css:37-48, 109-118`, `apps/web/src/styles/game-guide.css:137-139` |
| 딜 애니메이션 | 각 카드를 `FlyingHwatu`로 감싸 `applyShoeFlight`가 덱 위치를 측정 → `sutda-deal` 키프레임(회전 8°·축소 .82 → 제자리), 두 번째 장 200ms 지연. 뒤집기(back→face) 없음 | `SutdaRoomPage.tsx:360-361, 386-396`, `table-sutda.css:66-80`, `apps/web/src/lib/shoeFlight.ts:1-40` |
| reduced-motion | 애니메이션 제거 | `table-sutda.css:80` |
| 쇼다운 공개 연출 | 없음 — 뒷면 요소(key=index)가 앞면 요소(key=card.id)로 **교체 마운트**되어 덱에서 다시 날아오는 형태 (추정) | `SutdaRoomPage.tsx:359-361` |
| 사운드 | 모든 효과음이 **TTS 멘트**: DEALING 진입 `deal`="베팅이 마감됐습니다", 내 턴 `turn`="당신의 차례입니다", 콜/하프 성공 `chip`="베팅을 시작하겠습니다", 다이 `fold`="Fold"(영어), 승/패 "승리했습니다/패배했습니다", 재경기 `tie`="Tie" | `SutdaRoomPage.tsx:74, 80, 96, 105, 138`, `apps/web/src/lib/sound.ts:6-20`, `scripts/generate-sounds.py:25-39` |
| 섯다 전용 사운드(화투 던지기·쪼기·족보 외침) | 없음 | — |

### B3-6. 도움말 시트 (`apps/web/src/lib/guides/sutda.tsx`)

- 3탭: 족보표(티어별 그룹, 실제 화투 이미지, 8끗~1끗은 한 행으로 압축, 특수패 3종) / 게임 방법(5단계 + 4버튼 설명 + 타임아웃·한도 노트) / 용어(족보·끗·땡·광·띠·열끗·삥·선·팟·재경기) (`:92-157`). `GameShell`의 "도움말" 버튼과 `openGameGuide("rankings")` 이벤트로 열림 (`GameShell.tsx:57-69, 126-129`).
- **서버 규칙과 어긋나는 부분**
  1. `:151` 재경기 "낸 돈을 모두 돌려받아요" — 실제는 팟(다이한 사람 앤티 포함)을 생존자끼리 균등 분할 (B1-7).
  2. `:117, 148` "삥 = 판 시작 시 모두 내는 기본 베팅" — 표준 용어의 삥(기본 머니만큼 베팅하는 **액션**)과 다른 의미로 사용. 헤더 "삥 N"(`SutdaRoomPage.tsx:153`)도 같은 의미.
  3. `SUTDA_SPECIALS` `:170` "장땡·광땡이 없으면 재경기" — 코드와는 일치하나 표준(장땡까지 재경기)과 다름.
  4. 레이크 비율·상한 미기재 (`:150`).
  5. 매 판 재준비가 필요하다는 사실 미기재; 레일 힌트 `SutdaRoomPage.tsx:300` "승부가 끝나면 다음 판에 자동으로 참여합니다"는 `ready.clear()`와 모순.
- 별도의 구형 `SutdaHandGuide` 팝오버 컴포넌트는 **어디서도 import되지 않는 죽은 코드** (`apps/web/src/components/SutdaHandGuide.tsx`, 스타일 `styles.css:4442`, `table-sutda.css:103-107`).

### B3-7. 모바일 대응

| 모드 | 동작 | 근거 |
| --- | --- | --- |
| 가로 폰 (≤900px 또는 ≤560px 높이) | 같은 2단 레일(150px)로 축소, 턴 스트립·패널 헤더 숨김, 3버튼을 2열+1줄로, 카드 24×37 | `table-holdem.css:359-435`, `table-pvp.css:176-205, 322-329`, `table-sutda.css:109-118` |
| 세로 폰/태블릿 (portrait ≤900px) | 테이블 위 + 레일이 하단 독(`max-height: 48dvh`, 스크롤), 내 좌석 카드 숨김(레일 패널의 22×34 미니가 유일한 내 패 표시), 타이머 링 숨김, 덱 숨김, 3버튼 3열 | `table-pvp.css:211-299, 332-345`, `table-sutda.css:47` |
| 매우 짧은 세로(≤700px 높이) | 독 50dvh, 강도 문장 숨김 | `table-pvp.css:302-311` |
| 전체화면 | `requestFullscreen` 토글 | `SutdaRoomPage.tsx:63-67, 159` |

---

## B4. 한국 표준 온라인 섯다 대비 빠진 것 / 약점

표준 기준: 한게임 섯다 베팅 종류 = **콜·삥·다이·체크·따당·하프·풀** + 1인 1판 최대 베팅 + 베팅룰(일반/111/222/333/444); LA섯다는 **쿼터·맥스** 추가(삥·체크는 보스만). 재경기 = 판돈 유지 + 새 패. 광땡 38 > 18 = 13. 피망은 2장/3장 섯다 제공, 돈이 모자라면 강제 올인.

| 항목 | 상태 | 근거·비고 |
| --- | --- | --- |
| 삥(기본 머니 베팅 액션) | **부분** | 앤티로만 자동 납부; 액션 없음 `sutda-room-manager.ts:67`, `contracts:526` |
| 따당(앞 베팅 2배) | **없음** | `contracts:526` |
| 쿼터(판돈 1/4) | **없음** | `contracts:526` |
| 하프(콜 + 판돈 1/2) | **있음** | `sutda-room-manager.ts:52` — 표준 정의와 계산 일치 |
| 풀/맥스(남은 한도까지) | **없음** | 하프가 한도에 잘릴 뿐 "한도까지 한 번에" 버튼 없음 `:52` |
| 체크 | **있음** | `toCall = 0`일 때 `:49` |
| 콜 / 다이 | **있음** | `:49` |
| 베팅 캡 | **있음** | 1인 1판 총액 ≤ `max_bet` `:53`; 레이즈 횟수 캡·베팅룰(111 등)은 없음 |
| 자동 콜 / 자동 다이 예약 | **없음** | 타임아웃 자동 체크/다이만 `:71` |
| 구사(4띠·9띠) 재경기 | **없음** | `game-core/sutda.ts:53, 55` (열끗 조합만 인식) |
| 멍텅구리 구사 | **부분** | 판정 있음; 장땡이 재경기 차단(표준: 광땡만 차단) `sutda.ts:69`; 재경기 = 균등 분할 후 판 종료, 판돈 이월·재딜 없음 `sutda-room-manager.ts:76` |
| 땡잡이 / 암행어사 | **있음** | `sutda.ts:52, 54, 70-77`, 테스트 `sutda.test.ts:26-70` |
| 광땡 서열(38 > 18 = 13) | **있음** | `sutda.ts:44-45` |
| 6매/3장 섯다 | **없음** | `contracts:524, 541`, `sutda-room-manager.ts:67-70` |
| 40장(피 포함) 변형 | **없음** | `sutda.ts:18-25` |
| 선 규칙 | **부분** | 시계방향 자동 로테이션 + 선이 마지막 행동 `:66-67`; "이긴 사람이 선"/선 우선 베팅 등 옵션 없음 |
| 무승부 처리 | **있음(분할)** | 동점 균등 분할 `sutda-service.ts:33-35` (한게임식 재경기/이월 옵션 없음) |
| 올인 / 사이드팟 | **없음** | 잔액 부족 → 다이만 `:49`; 피망은 강제 올인 |
| 판 히스토리(지난 판 결과) | **부분** | 직전 판 승자 pill만 `:54` `lastWinners`, `SutdaRoomPage.tsx:185-193` |
| 전적 / 승률 | **없음** | 사용자 게임 히스토리 API와 관리자 통계 CTE 모두 `sutda_contributions` 미조회 `main.ts:146-158, 673-700` |
| 상대 패 공개 연출(쪼기/스퀴즈/뒤집기) | **없음** | 쇼다운 즉시 교체, flip 없음 `SutdaRoomPage.tsx:359-361`, `table-sutda.css:66-79` |
| 자리 비움(사이드아웃 토글) | **부분** | 이탈 시 서버가 `sittingOut` 표시만 `:25, 54`; 사용자가 누르는 "자리 비움" 없음, "자리 비우기"는 퇴석 `:144-148` |
| 관전 | **있음** | 착석 없이 join 가능, 카드 비공개 `:24, 54`, `SutdaRoomPage.tsx:215-219` |
| 채팅 | **있음** | `RoomChat` `:330`, 채널 `sutda-room:` `main.ts:990` |
| 이모티콘 | **없음** | — |
| 아바타 | **없음** | 닉네임 텍스트만 `SutdaRoomPage.tsx:366` |
| 랭킹 | **없음** | — |
| 데일리 미션 | **없음** | — |
| 타임뱅크 / 시간 연장 | **없음** | 20초 고정 `:13` |
| 접속 끊김 보호 | **부분** | 좌석 유지·재접속 복귀 `:24-25`; 유예 시간 없이 20초 후 자동 다이; 대기 중 이탈 좌석 미회수(B5 #1) |
| 담합 방지 | **부분** | 레이크 기준 웨이저링 캡 `sutda-service.ts:55-61`; 같은 IP/기기/자금 흐름 탐지, 쇼다운 로그 검토 도구 없음 |
| 위너 피드(로비/테이블 티커) | **없음** | 홀덤은 `room.winners` 브로드캐스트 `holdem-room-manager.ts:412-427`; 섯다 액터·페이지 모두 없음 |
| 판 사이 카운트다운 | **없음** | RESULT 5초 후 즉시 WAITING `:70` (홀덤 `HAND_BREAK_MS`) |
| 매 판 자동 진행 | **없음** | 매 판 `ready.clear()` `:60` |
| 튜토리얼/봇 연습 | **없음** | `docs/roadmap.md:62` 미완료 항목 |

---

## B5. 코드 품질·버그 후보

TODO/FIXME/XXX/HACK 마커: 섯다 관련 파일 전체에 **0건**.

### B5-1. 서버 버그 후보 (심각도 순)

1. **대기 중(WAITING) 이탈 좌석이 회수되지 않아 테이블이 잠김** — `leave()`는 `sittingOut.add`만 하고 좌석·`ready`를 그대로 둔다 (`sutda-room-manager.ts:25`). 좌석은 `reset()`(판 종료 후)에서만 회수되므로(`:60`), **준비를 누르지 않은 채 창을 닫은 사람**이 있으면 `allReady()`(`:58`)가 영원히 false → 남은 사람들은 판을 시작할 수 없다. 홀덤은 "판돈이 걸려 있지 않으면 즉시 좌석 해제"로 고쳤다 (`holdem-room-manager.ts:160-177`). 또한 `leave()`는 스냅샷을 재전송하지 않아 다른 사람이 `is-away` 상태를 바로 보지 못한다.
2. **`launch()` ↔ `play()` 무한 재시도 루프(DB 폭주)** — `play()`는 `eligible < 2`/`order < 2`면 `reset()` 없이 `return`(`:67`)하는데, `launch()`의 `.finally`가 무조건 `launch()`를 다시 부른다(`:59`). `seatedCount`는 `sittingOut` 좌석도 세고 `ready`도 남아 있으므로 조건이 그대로 참 → `play()` 재호출 → 매회 `getUserBalance` 조회 → 반복. 트리거 예: (a) A가 준비 후 이탈(#1) + B 준비, (b) 앞 판에서 잔액이 `min_bet×2` 미만이 된 사람이 준비를 누름(`:67`에서 `sittingOut` 처리 후 eligible 1명). 홀덤도 (b) 변형을 공유한다 (`holdem-room-manager.ts:460-476, 520-528`). (추정: 코드 흐름 기준, 실행으로 재현하지는 않음)
3. **재경기 정산이 안내와 다르고 돈이 이동함** — `redeal`이면 활성 전원을 승자로 `settle(takeRake=false)` (`:76`) → `(총액)/n` 균등 분할 (`sutda-service.ts:33-35`). 다이한 사람의 앤티가 생존자에게 분배되고, 스트리트 중 기여액이 달랐다면 많이 낸 사람이 손해. 도움말 "낸 돈을 모두 돌려받아요"(`guides/sutda.tsx:151`) 및 클라이언트 문구 "재경기 · 베팅금 반환"(`SutdaRoomPage.tsx:103`)과 불일치. 정산 라벨도 `payout !== amount`면 **lose**로 기록(`sutda-service.ts:52-53`).
4. **클라이언트 재경기 분기 도달 불가** — 재경기 시 활성 전원이 `lastWinners`에 들어가므로 `mine`이 항상 존재 → "멍텅구리 구사 · 재경기 승리" 배너 + 승리 사운드 (`SutdaRoomPage.tsx:93-96`); `isRedeal` 분기(`:97-105`)는 죽은 코드.
5. **멍텅구리 구사 판정이 표준과 다름** — 장땡(910)이 있으면 재경기 불성립 (`sutda.ts:69`). 표준: 광땡만 차단(장땡은 지역차). 테스트도 "장땡이 재경기를 막는다"를 고정하고 있어(`sutda.test.ts:47-54`) 의도적 선택이지만 표준과 어긋남.
6. **일반 구사(4띠·9띠) 미구현** — 3끗으로만 처리 (`sutda.ts:53, 55`).
7. **마지막 생존자 다이 허용 → 정산 예외** — `die`에 생존자 수 가드가 없다(`:49`). 자리 비우기(`:35-38`)로 상대가 폴드된 직후 내 턴에 다이하면 `active()=0` → `resolveSutdaWinners([])` → `winnerIds=[]` → `settle`에서 `share = total/0` → 원장 엔트리 불균형 예외 → `refundRound` (`:73-76`, `sutda-service.ts:33-35, 44-45`). 결과적으로 전액 환불이지만 콘솔 오류 + 사용자 알림 없음. (추정)
8. **매 판 재준비 강제** — `reset()`의 `ready.clear()`(`:60`)로 판마다 전원이 다시 준비를 눌러야 한다. 레일 힌트 `SutdaRoomPage.tsx:300`("다음 판에 자동으로 참여합니다")과 모순.
9. **게임 히스토리·관리자 통계에서 섯다 누락** — `/api/v1/game-history`(`main.ts:673-700`)와 `ALL_BETS_CTE`(`main.ts:146-158`)가 `holdem_contributions`까지만 UNION. `GAME_TYPE_LABEL.sutda`(`apps/web/src/lib/gameLabels.ts:12`)는 있으나 데이터가 오지 않음.
10. **재시작 복구가 무조건 환불** — 2장 모두 저장된 뒤 중단된 판도 정산하지 않음 (`sutda-service.ts:72-76`); 홀덤은 리버까지 진행된 핸드를 저장 보드로 정산 (`holdem-service.ts:222-265`).
11. **판 처리 실패 시 사용자 알림 없음** — `notification` 이벤트 미발송 (`:59` vs `holdem-room-manager.ts:469-471`).
12. **스냅샷 N+1 조회** — 참가자 × (좌석+1)회의 `getUserBalance` (`:54-55`).
13. `SEATS`, `ACTION_MS` 등 상수가 클라이언트에 중복 하드코딩 (`SutdaRoomPage.tsx:19` vs `sutda-room-manager.ts:13`).

### B5-2. 규칙 불일치 요약 (도움말 vs 서버 vs game-core/테스트 vs 표준)

| 주제 | 도움말/클라이언트 | 서버 | game-core/테스트 | 표준 |
| --- | --- | --- | --- | --- |
| 재경기 판돈 | "낸 돈 모두 반환" / "베팅금 반환" | 활성 전원 균등 분할 후 종료 | `redeal:true` 반환만 (테스트 없음) | 판돈 이월 + 새 패 |
| 멍텅구리 구사 vs 장땡 | "장땡·광땡 없으면 재경기" | game-core 위임 | 장땡이 차단 (`test:47-54`) | 광땡만 차단(장땡 지역차) |
| 구사(띠) | 언급 없음 | 없음 | 없음 | 알리 이하면 재경기 |
| 삥 | "판 시작 시 내는 기본 베팅" | 앤티 | — | 베팅 액션 명(기본 머니) |
| 자동 참여 | "다음 판 자동 참여" | 매 판 재준비 필요 | — | 자동 진행이 일반적 |
| 올인 | "잔액 부족이면 다이만" | 동일 | — | 강제 올인(피망) |

### B5-3. 테스트 커버리지

- `packages/game-core/src/sutda.test.ts`(129줄): 덱 20장, 광땡 서열, 알리/세륙/갑오 라벨, 암행어사 vs 13·18/38광땡, 특수패 폴백 rank, 멍텅구리 vs 장땡(재경기 불성립), 땡잡이 vs 9땡/광땡, 참고 데이터 정합성, 강도·티어, 노려볼 패.
- **없는 테스트**: `redeal: true` 경로, 13 vs 18광땡 동점 분할, 땡잡이 vs 장땡(폴백 망통 패배), 다수 동점자, 암행어사+땡잡이 동시 존재, 룸 액터 전체(베팅 루프·타임아웃·이탈·정산 호출), `sutda-service.settle/refund`(홀덤 서비스 테스트도 `rakeFor`만 검증 `holdem-service.test.ts:15-23`). API 쪽에 섯다 테스트 파일이 전혀 없다 (`apps/api/src/**/*.test.ts` 목록에 sutda 없음).

### B5-4. 홀덤/블랙잭 재사용으로 생긴 어색함

- 클래스명 전반이 `holdem-*`(`holdem-room-shell`, `holdem-felt`, `holdem-table`, `holdem-board`, `holdem-pot`, `holdem-winners`, `holdem-seat*`, `holdem-rail-v4`, `holdem-hand-panel`, `holdem-act-row`, `holdem-ready-dock`, `holdem-timer`) (`SutdaRoomPage.tsx:166-331`). `table-sutda.css:2-11` 주석이 이를 의도된 공유라고 명시.
- 준비 버튼이 블랙잭 클래스 `bj-act-hit/bj-act-surrender`를 씀 (`SutdaRoomPage.tsx:308`, `styles.css:4318-4321`).
- 용어: 팟(`pot`), 스택, "콜/체크" 등 포커 용어가 그대로. 섯다식 "판돈/받기/죽기"가 아닌 점은 도움말 용어 탭으로 보완 (`guides/sutda.tsx:143-152`).
- 하프 규칙 자체가 "홀덤 하프 프리셋 관행"에서 온 것으로 주석에 명시 (`sutda-room-manager.ts:49-51`).
- 사운드가 바카라/포커용 TTS 멘트("베팅이 마감됐습니다", "Fold", "Tie") (`scripts/generate-sounds.py:25-39`).
- 위너 pill·결과 배너·칩 스택·채팅은 홀덤 컴포넌트 그대로 (`ChipStack`, `RoundResultNotice`, `RoomChat`).

### B5-5. 죽은 코드·정리 대상

- `apps/web/src/components/SutdaHandGuide.tsx` — 미사용.
- `apps/web/src/styles.css:4436-4443` — v1 섯다 테이블(`.sutda-table/.sutda-center/.sutda-actions`) 규칙; `table-sutda.css:10-11` 주석이 "의도적으로 방치"라고 명시. `.hwatu-card/.hwatu-month/.hwatu-back` 기본 규칙만 살아 있음.
- `apps/web/src/styles.css:4455-4481` — `.sutda-felt .sutda-actions.on-felt` 등 v3 온-펠트 액션 규칙(현재 마크업에 없음).
- `table-sutda.css:103-107` — `.sutda-guide` 팝오버 위치(미사용 컴포넌트용).
- `contracts` `hwatuKindSchema`의 `kasu`, `RoomPhase`의 `SETTLING` 등 섯다에서 쓰지 않는 값 (`contracts:515, 15-27`).
- `docs/architecture.md` 섯다 미기재; `docs/roadmap.md` Milestone 4에 섯다 출시 항목 없음(Milestone 5 UX 항목만 `:54-61`).

### B5-6. 히스토리 (git)

| 커밋 | 날짜 | 섯다 관련 내용 |
| --- | --- | --- |
| `8752881` seotda add | 2026-08-26 | 룸매니저 53줄·서비스·`sutda_contributions` 스키마·시드 3방·48장 화투 PNG·main.ts 배선 |
| `69dc237` sutda improve | 2026-08-27 | v2 페이지(홀덤 테이블 시스템 위 화투), `back.svg`, `table-sutda.css`, `cardCount`(추정), 특수패 폴백 rank 수정, 테스트 +21 |
| `0f73556` beginner-friendly PvP | 2026-09-15 | 단계 바·족보 패널·강도 미터·노려볼 패·도움말 시트·세로 모드·땡잡이 vs 광땡 판정 수정·판 중 착석 좌석 제외·자리 비우기 즉시 다이·오류 한글화 |
| `051451d` fix settlement | 2026-09-17 | 정산 win/lose 라벨 수정(`sutda-service.ts:48-53`), 화투 월 숫자 배지 |

---

## 참고 출처 (표준 규칙)

- 한게임 섯다 게임가이드 – 베팅: https://gostop.hangame.com/gameGuide/gssudda/guide_gssudda01_04.html (리다이렉트: https://hangame-images.toastoven.net/hangame/pc/gostop/introduce/html/gssudda/guide_gssudda01_04.html) — 콜/삥/다이/체크/따당/하프/풀 정의, 1인 1판 최대 베팅, 베팅룰 일반/111/222/333/444
- 한게임 LA섯다 베팅 방법: https://poker.hangame.com/gameguide/lasudda/game_lasudda2_1.html — 쿼터(판돈 1/4)·맥스, 삥·체크는 보스만
- 섯다 족보 멍텅구리 구사(사구) 차이점 및 재경기 룰: https://playcard.warmissue.com/2023/05/-_01697740272.html — 구사는 알리 이하 재경기, 멍텅구리 구사는 땡까지 재경기(장땡 지역차), 재경기 절차
- 섯다 치는법 규칙 족보 점수 순서 총정리 (brunch): https://brunch.co.kr/@42f564d010b5451/359 — 38광땡 > 18광땡 = 13광땡, 암행어사·땡잡이 범위, 재경기 시 판돈 유지 후 새 패
- 피망 섯다 (나무위키): https://namu.wiki/w/%ED%94%BC%EB%A7%9D%20%EC%84%AF%EB%8B%A4 — 2장/3장 섯다 제공, 돈 부족 시 강제 올인, 기권승
- 한게임 섯다&맞고 게임 모드 가이드 (BlueStacks): https://www.bluestacks.com/ko/blog/game-guides/hangeim-seosda/hs-game-modes-guide-ko.html — 2장/3장 방식, 종료 조건
