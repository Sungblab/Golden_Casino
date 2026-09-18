# A. 홀덤 현재 구현 인벤토리 (코드 리서치, 읽기 전용)

작성 기준: 워킹트리 `main` (HEAD `ac2d15c`, 2026-09-18). 모든 경로는 `C:\Users\Sungbin\Documents\GitHub\Golden_Casino\` 기준 상대경로. `파일:줄` 근거를 붙였고, 코드에서 직접 확인되지 않은 것은 "(추정)"으로 표시. 런타임 실행 검증은 하지 않았음(코드 정독만).

핵심 파일:
- 서버 룸 액터: `apps/api/src/games/rooms/holdem-room-manager.ts` (774줄)
- 원장/정산/복구: `apps/api/src/games/holdem/holdem-service.ts` (309줄)
- 순수 로직: `packages/game-core/src/holdem.ts` (256줄)
- 계약: `packages/contracts/src/index.ts:403-509`, 소켓 이벤트 `:754`, `:780-785`
- 클라이언트: `apps/web/src/pages/HoldemRoomPage.tsx` (547줄), `components/HoldemHandPanel.tsx`, `lib/holdemHandRead.ts`, `lib/guides/holdem.tsx`, `styles/table-holdem.css`, `styles/table-pvp.css`

---

## A1. 테이블·게임 규칙 (서버 기준)

### 좌석·방 설정
| 항목 | 값 | 근거 |
|---|---|---|
| 좌석 수 | 6 (6-max) | `holdem-room-manager.ts:49` `SEAT_COUNT = 6` |
| 방 3개 | Micro `min_bet 1 / max_bet 100`, Standard `10 / 1,000`, High Roller `50 / 5,000` (DB `game_rooms` 시드, `side_bet_max` null) | `apps/api/src/database/seed.ts:25-27` |
| 블라인드 | SB = `min_bet`, BB = `min_bet × 2` → Micro 1/2, Standard 10/20, High 50/100 | `holdem-room-manager.ts:565-568` |
| 앤티 | 없음 | 블라인드 두 번만 `postBlind` (`:565-566`) |
| 바이인 최소 | 앉을 때 지갑 잔액 ≥ BB(`min_bet*2`) 필요 | `:189-190` (`INSUFFICIENT_BALANCE`) |
| 바이인 최대 / 테이블 스택 | **바이인 개념 자체가 없음**. 좌석 스택 = 지갑 전체 잔액. 콜/레이즈/올인 한도도 지갑 잔액 | `:345` (`stack: await walletService.getUserBalance`), `:266`, `:275` |
| `max_bet`의 실제 용도 | **베팅 상한·바이인 상한으로 전혀 쓰이지 않음**. 오직 레이크 상한 계산에만 사용 | `:702`, `holdem-service.ts:15-18`. 섯다는 `TABLE_LIMIT_REACHED`로 상한 강제(`sutda-room-manager.ts:53`)하지만 홀덤엔 없음 |
| 리바이/탑업 | 해당 없음(지갑이 곧 스택이라 입금이 곧 탑업). 핸드 중 잔액 변동도 즉시 반영됨 | `:345`, `:266` |
| 핸드 시작 시 빈털터리 처리 | 핸드 시작 시점에 잔액 < `min_bet`(SB)인 좌석은 `sittingOut`으로 표시 → 핸드 종료 후 좌석 해제 | `:523-526`, `:489-493` |
| 불일치 | 착석 기준은 BB(`min_bet*2`), 핸드 시작 기준은 SB(`min_bet`) → 잔액이 SB~BB 사이인 사람은 딜인되고 숏 블라인드 올인 | `:190` vs `:525` |

### 핸드 시작 조건·타이밍
| 항목 | 값 | 근거 |
|---|---|---|
| 시작 조건 | `seatedCount ≥ 2` **그리고 앉은 사람 전원이 준비(ready)** 상태, `paused` 아님, 단계 `WAITING` | `:456-461` |
| 준비 상태 | sticky — 한 번 준비하면 취소/기립 전까지 유지 | `:73-76`, `:494-496` |
| 준비 안 한 사람 처리 | **타임아웃 없음**. 앉아만 있고 준비 안 하면 테이블 전체가 무기한 정지 | `:456-461` (`allSeatedReady`) |
| 상수 | `BETWEEN_HANDS_MS 4,000`, `HAND_BREAK_MS 6,000`, `ACTION_MS 20,000`, `REVEAL_STEP_MS 900`, `SHOWDOWN_MS 5,000` | `:50-57` |
| 시퀀스 | DEALING(홀카드) 0.9s → 프리플랍 PLAYER_TURN(턴당 최대 20s) → 각 스트리트 DEALING 0.9s + 베팅 → SETTLING(정산 즉시) → RESULT 라벨 5s → 실제 대기 5s(쇼다운/풀보드) 또는 4s(프리플랍 폴드 승) → `WAITING` + `phaseEndsAt` 6s 휴식 → 다음 핸드 | `:554,561`, `:654-656`, `:633-634`, `:701`, `:717`, `:586`, `:593-600` |
| 핸드 사이 총 대기 | 약 10~11초 (RESULT 4~5s + 휴식 6s). 휴식 구간이 기립/준비취소가 가능한 유일한 창 | `:51-54`, `:588-592` |
| 액션 타이머 | 20초 고정. 만료 시 `toCall == 0`이면 자동 체크, 아니면 자동 폴드 | `:658-672` |
| 타임뱅크 | 없음 | 연장 API/상태 없음 |

### 포지션·블라인드·버튼
| 항목 | 값 | 근거 |
|---|---|---|
| 버튼 로테이션 | 현재 버튼 좌석 다음의 착석(비 sittingOut) 좌석. 버튼 좌석이 비면 `seatedOrder[0]` | `:604-608` |
| 헤즈업 | 버튼 = SB, 상대 = BB. 프리플랍 버튼(SB) 먼저, 포스트플랍 BB(버튼 다음) 먼저 | `:541-543`, `:571`, `:637` |
| 3인 이상 | order = [BTN, SB, BB, UTG…]; 프리플랍 first = `order[3] ?? order[0]` (3인일 땐 BTN), 포스트플랍 = 버튼 다음 첫 컨텐더 | `:540-543`, `:571`, `:637` |
| 데드 버튼/미싱 블라인드 | 없음. 매 핸드 착석 순서로 SB/BB를 다시 계산할 뿐 | `:539-543` |
| 새로 앉은 사람 첫 핸드 | 즉시 다음 핸드 딜인(BB 대기·포스트 없음). 핸드 도중 착석은 허용되나 그 핸드에는 미참여(`contenderSeats`는 홀카드 받은 좌석만) | `:184-198`, `:511-513`, `:527-543` |
| 블라인드 강제 | 잔액 부족 시 `min(amount, balance)` 포스트 후 올인 | `:610-617` |
| 덱 | 1덱 `Shoe(1)`, 남은 카드 < 20이면 재셔플(핸드 간 덱 재사용) | `:68`, `:553`; 셔플은 `crypto.randomInt` Fisher-Yates (`packages/game-core/src/shoe.ts:40-43`) |

### 베팅 규칙
| 항목 | 값 | 근거 |
|---|---|---|
| 액션 종류 | `fold / check / call / bet / raise / allin` | `contracts:413` |
| amount 의미 | "raise to" — 이번 스트리트 누적 기여 목표액(정수 코인) | `contracts:506-507`, `:275-278` |
| 최소 레이즈 | 스트리트 시작 시 `minRaise = BB`; 풀 레이즈(`raiseSize ≥ minRaise`)일 때만 `minRaise = raiseSize`로 갱신 | `:568`, `:631`, `:284` |
| 레이즈 유효성 | `targetTotal > currentBet` 아니면 `RAISE_TOO_SMALL`; `raiseSize < minRaise`는 `increment === balance`(숏 올인)일 때만 허용 | `:277`, `:281-282` |
| 숏 올인 처리 | 액션 재오픈 없음(`actedSinceLastRaise` 리셋은 풀 레이즈만). 단 이미 액션한 사람도 `streetContributed !== currentBet`이면 다시 프롬프트되고 **레이즈까지 가능**(표준 룰은 콜/폴드만) | `:286-290`, `:681-688`, `:274-293`에 재레이즈 제한 없음 |
| 폴드 | `toCall == 0`이어도 폴드 가능(자기 베팅 포기) → 그 슬라이스는 무레이크 환불 | `:256-260`, `holdem-service.ts:108-122` |
| 콜 | `min(toCall, balance)`; 부족하면 낸 만큼 내고 올인 | `:267-272` |
| 올인 | `targetTotal = streetContributed + balance`; `≤ currentBet`이면 **에러**(`RAISE_TOO_SMALL`) — 콜 금액도 못 덮는 숏스택은 `allin` 액션 불가, `call`로 처리해야 함 | `:275-277` |
| 베팅 라운드 종료 | 폴드/올인 아닌 전원이 `actedSinceLastRaise`에 있고 `streetContributed === currentBet` | `:681-688` |
| 전원 올인 런아웃 | 액티브(비올인) ≤ 1이면 베팅 라운드 스킵, 스트리트는 0.9s DEALING 간격으로 자동 진행 | `:644`, `:619-640` |
| 사이드팟 | `buildHoldemPots` — 기여액 레벨별 슬라이스, 폴드자는 `eligible` 제외/`contributor` 포함 | `packages/game-core/src/holdem.ts:120-138`; 스냅샷용 `:390-399` |

### 쇼다운·승자·팟 분배
| 항목 | 값 | 근거 |
|---|---|---|
| 쇼다운 공개 | `street === "showdown"`이면 **폴드하지 않은 전원**의 홀카드를 모두에게 공개. 순서 없음, 머크 없음 | `:330`, `:355` |
| 폴드 승 시 | `showdown()`은 폴드 승에도 호출되어 `street = "showdown"` → **혼자 남은 승자의 카드도 공개됨** (도움말과 불일치, 아래 A5) | `:584`, `:700`, `:355` |
| 승자 결정 | 팟별로 `evaluateBestHoldemHand`(7장 중 21조합) + `comparePokerHands`; 동률은 균등 분할 | `holdem-service.ts:126-136`, `game-core/holdem.ts:104-117` |
| 홀수 칩 | 나머지는 `winnerIds[0]`(DB 조회 순서상 첫 사람) — 버튼 좌측 우선 규칙 아님 | `holdem-service.ts:133-136` |
| 승자 `amount` | `payout − contribution`(순이익). 분할팟은 레이크 때문에 **음수 가능** | `holdem-service.ts:188` |
| 레이크 | 팟별 5%, 상한 = `max_bet × 3%` (Micro 3코인, Standard 30, High 150). **노플랍 노드랍 없음** — 프리플랍 폴드 승 팟도 레이크 | `holdem-service.ts:13-18`, `:123-124`, `:126-127` |
| 무경쟁 슬라이스 | 기여자 전원 폴드한 슬라이스는 무레이크 환불 | `holdem-service.ts:108-122` |

### 이탈·접속·복구
| 항목 | 값 | 근거 |
|---|---|---|
| 소켓 끊김/방 나감 | 마지막 소켓이 떠나면 참가자 제거. 핸드 중 칩 있으면 `sittingOut`(좌석 유지, 자기 턴에 **20초 타임아웃으로** 체크/폴드, 핸드 끝나면 좌석 해제); 아니면 즉시 좌석 해제 | `:156-182`, `:658-672`, `:489-493`; `disconnect` → `leave` (`:751-753`, `main.ts:1144-1150`) |
| 즉시 폴드 | `standUp`만 즉시 폴드+턴 해제. 끊김은 즉시 폴드 아님(주석 "folds when its turn comes"는 타이머 경유) | `:208-214` vs `:170-172` |
| 재접속 | `join`이 `sittingOut` 해제, 스냅샷(내 홀카드 포함) 반환 → 상태 복원. 단 끊긴 동안 만료된 턴은 이미 자동 처리됨. 접속 끊김 보호 없음 | `:141-154`, 클라 `HoldemRoomPage.tsx:56` |
| 라이브 프로세스 내 핸드 오류 | `launchCycle` catch → `refundRound` + 상태 리셋 + 에러 알림 | `:463-471` |
| 프로세스 재시작 | `recoverInterruptedRounds`: 보드 5장 + 비폴드 기여자 전원 홀카드 2장이면 정산, 아니면 환불+ABORTED. **홀카드가 DB에 기록되지 않아 실제로는 항상 환불 경로**(A5 #1) | `holdem-service.ts:222-265`, `main.ts:1197-1204` |
| 일시정지 | 관리자 pause는 새 핸드만 막음(진행 중 핸드는 계속) | `:123-126`, `:461` |

### 채팅·관전
- 관전: 착석 없이 `holdem.join`만으로 가능. 보드·좌석·카드백(`dealtIn`)·팟 보임, 홀카드는 안 보임. 펠트에 "빈 자리를 눌러 앉으세요 · 관전은 자유" 프롬프트 — `:141-154`, `:355-358`, `HoldemRoomPage.tsx:303-308`
- `playerCount`는 관전자 포함 참가자 수 — `:96-98`
- 채팅: 레일 푸터의 `RoomChat`(REST 히스토리 + 소켓), 참가자만 전송 가능, 1~500자, `holdem-room:{id}` 채널로 방송 — `HoldemRoomPage.tsx:427`, `main.ts:981-996`, `components/RoomChat.tsx`

---

## A2. 서버 아키텍처·원장

### 구조
- 방마다 `HoldemRoomActor` 인메모리 액터, `HoldemRoomManager`가 DB `game_rooms WHERE game_type='holdem'`로 생성 — `:721-734`. 공통 베이스 클래스는 없음: `room-manager.ts`는 바카라 전용 `AutomaticBaccaratRoomActor`이고 홀덤은 같은 패턴(participants/usernames/cycleToken/setPhase/emitSnapshots)을 복제 — `room-manager.ts:71-390` vs `holdem-room-manager.ts:63-719`.
- `main.ts`에서 별도 매니저 인스턴스(`:60`), 소켓 핸들러 `holdem.join/leave/sit/standUp/ready/act`(`:884-950`), 로비 방 목록 합산(`:70`), pause 체인(`:75,82`), 채팅 참가자 체크(`:986`), 초기화 순서(홀덤 복구가 바카라 전역 스윕보다 먼저, `:1197-1204`).
- 소켓 커맨드 공통 가드: 초당 20커맨드 레이트리밋 + JWT 만료 + `users.approved` DB 조회 — `main.ts:772-785`.

### 원장 흐름
1. 기여(블라인드/콜/베팅): `contribute()`가 커넥션 트랜잭션 안에서 `HOLDEM_CONTRIBUTE` (user −, room +) 원장 거래 + `holdem_contributions` upsert(누적) — `holdem-room-manager.ts:296-320`, `holdem-service.ts:28-54`. 멱등키 `holdem-contribute:{roundId}:{userId}:{누적기여액}` (`:303`).
2. 상태 플래그: `markFolded`, `markAllIn`, `recordHoleCards`는 별도 UPDATE(트랜잭션 밖) — `holdem-service.ts:56-66`.
3. 정산: `settle()` 한 트랜잭션 `HOLDEM_SETTLED`: room −총팟, house +레이크, 승자 +payout; `holdem_contributions.payout_minor/outcome/settled_at` 갱신; 웨이저링 크레딧은 레이크 지분만(담합 세탁 방지) — `holdem-service.ts:144-204`.
4. 환불: `refundRound()` `HOLDEM_REFUNDED` + `outcome='push'` + `game_rounds.phase='ABORTED'` — `:268-305`.
5. 라운드: `game_rounds` INSERT(`phase='DEALING'`, `rules_version='holdem-v1'`, `round_number = MAX+1`) — `holdem-room-manager.ts:545-550`; 스트리트마다 `result_data={board,street}` 저장(`:627`); 종료 시 `phase='RESULT'`, winners 저장(`:716`). 바카라와 달리 중간 phase는 DB에 안 씀(`room-manager.ts:314-320` 대비). `one_active_round_per_room` 부분 유니크 인덱스로 미정산 라운드 1개 제한 — `schema.ts:236`.
6. 스키마: `holdem_contributions` (round/user 유니크, `hole_cards jsonb default '[]'`, `folded`, `all_in`, `payout_minor`, `outcome`) — `schema.ts:265-282`. 통계/히스토리는 이 테이블 기준(`main.ts:145-158`, `:692-698`).

### 스냅샷·브로드캐스트
- `snapshot(userId)`는 뷰어별로 생성 — `:328-388`. 담기는 것: room, roundId, sequence, phaseEndsAt, street, board, pots(amount+eligibleSeats), seats(닉네임·**stack=지갑잔액**·street/total 기여·folded·allIn·sittingOut·D/SB/BB·isTurn·holeCards·dealtIn·handCategory·ready), mySeatNumber, toCall, minRaiseTo, actingSeat(PLAYER_TURN일 때만), lastWinners, walletBalance. 계약 `contracts:435-486`.
- 비공개 정보: 홀카드는 본인 또는 쇼다운의 비폴드 좌석만(`:355`); `handCategory`도 쇼다운에만(`:364-366`). 누출 없음. 단 **폴드 승 시 승자 카드 공개**는 설계상 누출(A5 #5). 좌석 `stack`이 상대 지갑 잔액 전체를 노출하는 점은 프라이버시 관점에서 주목(바이인 개념 부재의 부작용).
- `emitSnapshots()`는 참가자(관전자 포함) 수만큼 `snapshot()`을 각각 호출 → 참가자 N × (좌석 6 잔액 쿼리 + 뷰어 잔액 1) DB 조회를 **모든 액션/단계 전환마다** 수행 — `:405-410`, `:345`, `:386`. 바카라는 공용 데이터를 한 번만 조회해 재사용(`room-manager.ts:265-271`)하지만 홀덤은 그런 최적화 없음. `act()`는 `emitSnapshots` 후 ack용 `snapshot()`을 한 번 더 호출(`:245-247`).
- 클라이언트는 `sequence >= current`로 중복/역전 스냅샷 무시 — `HoldemRoomPage.tsx:55`.

### 상태머신
- `RoomPhase` 공용 enum(`contracts:15-27`, WAITING/BETTING/LOCKED/DEALING/PLAYER_TURN/SETTLING/RESULT…) 중 홀덤 사용: `WAITING → DEALING(홀카드) → [PLAYER_TURN]* → DEALING(플랍) → [PLAYER_TURN]* → DEALING(턴) → … → DEALING(리버) → … → SETTLING → RESULT → WAITING(휴식, phaseEndsAt 있음)`. `street`는 `preflop|flop|turn|river|showdown|null` 별도 축 — `contracts:410`.
- 취소 토큰 `cycleToken`은 `startHand`만 증가시키므로 실제로는 동시 실행 방지 역할이 거의 없음(`cycleRunning`이 실질 가드) — `:89`, `:521`, `:461-462`.

---

## A3. 클라이언트 UX 인벤토리

### 레이아웃 (v4 하이브리드 레일)
- 데스크탑: `.ot-stage` 2열 그리드(테이블 `1fr` + 레일 `232px`), 액션은 펠트 위 오버레이가 아니라 별도 컬럼 — `table-holdem.css:22-29`, 설계 배경 주석 `:1-19`.
- 모바일 가로(≤900px 또는 ≤560px 높이): 같은 레일을 150px로 압축, 스테퍼 숨김, 액션 2×2, 턴 스트립 숨김(펠트 링이 대신) — `table-holdem.css:359-435`, `table-pvp.css:176-205`.
- 세로(portrait ≤900px): 테이블 위 + 레일이 하단 독(`max-height 48dvh`, 스크롤), 내 좌석 카드는 숨기고 독의 족보 패널이 크게 보여줌, 펠트 타이머 링 숨김 — `table-pvp.css:211-299`, 짧은 세로폰 보정 `:302-311`.
- 좌석 배치: `SEAT_ANGLES=[90,150,210,270,330,30]`, 내 좌석이 항상 하단(90°)이 되도록 회전 — `HoldemRoomPage.tsx:32`, `:436-439`; 반지름은 CSS 변수(`--seat-rx 45% / --seat-ry 33%`, 세로 40%/38%→35%) — `table-pvp.css:18-22`, `:219`, `:334`.
- **튜닝 페어**(한쪽만 바꾸면 겹침 재발): 좌석 y반경 33% ↔ `.holdem-action-line` `top 28% / height 42%`(내 좌석 카드 확대 포함) — `table-holdem.css:334-346`, `HoldemRoomPage.tsx:442-444`; 타이머 링 `top 33%` — `table-holdem.css:349`.
- 리얼 테이블 비주얼: 가죽 범퍼 `.holdem-table-rail` + 리세스드 펠트 `::before`(조명 풀·비네트), 크림색 이중 베팅 라인, 좌석 네임플레이트 — `table-holdem.css:238-318`. 덱은 보드 옆 딜러 자리(`:232-236`), 세로에선 숨김(`table-pvp.css:336-339`).

### 레일 구성 (위→아래, `HoldemRoomPage.tsx:314-429`)
1. `StepBar` 프리플랍→플랍→턴→리버→쇼다운 — `:315`, `:504-513`
2. `HoldemHandPanel` 내 족보(내 카드 있고 폴드 안 했을 때) — `:317-319`
3. 메타 라인: POT / 내 베팅 / 콜 금액 — `:321-325`
4. 내 차례일 때: 턴 스트립("내 차례예요" + 안내문 + 초 + 진행바) — `:329-336`; 프리셋 5개 + 스테퍼(`canRaise`일 때) — `:337-363`; 액션 버튼 행 — `:364-378`
5. 내 차례 아닐 때: 상태 문장(`railStatus`) + 폴드/올인/미참여 힌트 — `:382-389`, `:526-537`
6. WAITING: 준비 독(`n/m명 준비 완료`, 준비 완료/취소 버튼, 안내) — `:391-405`
7. 미착석 힌트 — `:407-409`
8. 푸터: 족보표 / 자리 비우기 / 채팅 토글 — `:415-428`

### 액션 버튼·프리셋·스테퍼
| UI | 동작 | 근거 |
|---|---|---|
| 폴드 (red) | `act("fold")` | `:365` |
| 체크 (gold) | `toCall === 0`일 때만 표시, `act("check")` | `:366-367` |
| 콜 N (blue) | `toCall > 0`일 때, 라벨에 `min(toCall, stack)`; 숏이면 힌트 "잔액 전부 · 올인" | `:368`, `:217-218` |
| 베팅/레이즈 N (green) | `canRaise`(= `maxRaiseTo > currentBet`)일 때, 스테퍼 값으로 `bet`(toCall 0) 또는 `raise` | `:369-376`, `:215` |
| 올인 N (purple) | `maxRaiseTo > 0`이면 항상 표시, `act("allin")` — 숏스택이면 서버가 거절(A5 #4) | `:377` |
| 프리셋 MIN/쿼터/하프/팟/맥스 | **원탭 즉시 액션**(한게임/피망식). 값 = raise-to 총액: MIN=`minRaiseTo`, 쿼터=`pot/4`, 하프=`pot/2`, 팟=`pot`, 맥스=올인. `[minRaise, maxRaiseTo]`로 클램프. 표준 "팟 사이즈 레이즈"(콜 후 팟 기준) 계산이 아니라 작은 팟에서는 쿼터/하프/팟이 전부 MIN으로 수렴 | `:203-214`, `:343-356` |
| 스테퍼 −/＋ | BB 단위 증감, 데스크탑 전용(모바일 숨김) | `:357-361`, `table-holdem.css:396-399` |
| 기본 레이즈값 | 턴이 올 때 `max(minRaiseTo, 2×toCall)` | `:89-94` |
| 슬라이더 | 없음(v3 range input CSS 잔재만 `styles.css:4177`) | — |

### 내 족보 패널
- `readHoldemHand(내 홀카드, 보드)`: 프리플랍은 "포켓 페어"/"A 하이 · AK 수딧" 힌트 + `holdemPreflopTier`(5단계), 플랍 이후 `evaluateBestHoldemHand` → 라벨(로열 플러시 별도 표기)·상세(“K와 7” 등)·사용 카드 키·`holdemCategoryTier`·드로우 문장 — `lib/holdemHandRead.ts:104-142`, `:61-97`.
- 드로우: `readHoldemDraws`(플랍/턴만, 플러시 4장·스트레이트 양방/속) — `game-core/holdem.ts:239-256`; 문장 예 "♠ 한 장 더 오면 플러시", "5 또는 10 중 하나가 오면 스트레이트 (양방)" — `holdemHandRead.ts:86-97`.
- 패널 UI: 미니 카드 2장(족보에 쓰이면 골드 링), 라벨/상세, `HandStrengthMeter`(5칸, "현재 조합 기준"/"시작 패 기준"), 드로우 목록, "족보표 전체 보기" 링크 → 가이드 rankings 탭 — `components/HoldemHandPanel.tsx:21-48`, `components/PvpBits.tsx:11-22`.
- 펠트의 보드/내 홀카드에도 같은 골드 링(`highlighted`) — `HoldemRoomPage.tsx:268`, `:291`, `:465`, `table-holdem.css:217-221`.
- 클라이언트 전용 계산이며 내 카드+공개 보드만 사용 → 누출 없음 — `holdemHandRead.ts:4-12`.

### 상대·좌석 표시 (`SeatView`, `HoldemRoomPage.tsx:441-501`)
- 카드: 내 카드/쇼다운 공개 = 앞면(`animate={false}`, 딜 애니 없음), 상대 딜인 = 카드백 2장, 미딜인 = 점선 슬롯 — `:459-472`, `dealtIn` 계약 `contracts:450-454`.
- 네임플레이트: D/SB/BB 배지(툴팁 설명), 닉네임(내 자리는 "나"), WAITING 중 준비 점, 스택(=지갑) — `:477-490`, `table-pvp.css:133-137`.
- 이번 스트리트 베팅 `ChipStack`(칩 팝 애니) — `:491`, `styles.css:4163`. 상대의 핸드 누적 기여액은 표시 안 함.
- 상태 필: 폴드 / 올인 / `WIN +N` / 쇼다운 족보명 — `:492-498`. `sittingOut`은 `.is-away` 투명도만(텍스트 없음) — `:454`, `styles.css:4171`. 마지막 액션(체크/콜/레이즈) 태그 없음.
- 내 좌석 카드 확대 — `table-holdem.css:351-356`.

### 타이머·내 차례·결과
- 내 차례: 펠트 중앙 SVG 링 + 초(`≤5s` closing 빨강), 턴 스트립, 상단 셸 phase 칩(“프리플랍 베팅 12”), `turn` 사운드 — `:296-301`, `:329-336`, `:227-234`, `:145-150`. `ACTION_SECONDS=20` 클라 하드코딩(서버 `ACTION_MS`와 이중 정의) — `:28`.
- 타 좌석 차례: "OOO님이 선택하는 중… 곧 내 차례가 와요" — `:534-535`.
- 쇼다운: 보드 아래 승자 필(닉네임 +금액 (족보) / "(상대 전원 폴드)"), 좌석 `WIN +N`, 족보 필(승자 골드) — `:273-281`, `:293`, `:496-498`, `table-pvp.css:143-144`.
- 내 결과 배너 `RoundResultNotice` 4.2초: 승리("투페어로 승리 +N"), 무승부("… 무승부 · 팟 분할", `amount ≤ 0`이면 tie 톤), 패배("OOO님의 플러시에 패배 −내 기여액") + win/tie/lose 사운드 — `:105-137`, `components/RoundResultNotice.tsx`.
- 서버 알림(핸드 중단 환불 등)은 `notification` 이벤트 — 홀덤 페이지는 **구독하지 않음**(`:61-64`에 핸들러 없음) (추정: 앱 셸 레벨에서 처리 여부 미확인).

### 애니메이션·사운드·채팅
- 딜: 보드 카드만 `PlayingCard` 비행+플립(`delayMs = index*120`), 덱(`DeckShoe`)에서 출발 — `:262-270`, `:251`, `components/PlayingCard.tsx:54-86`, `lib/shoeFlight.ts:29-64`. (`shoeFlight.ts:4-5` 주석 "holdem은 슈 없음"은 현재 코드와 불일치.) 홀카드는 애니 없음(`:464`). 칩→팟 수거, 팟→승자 이동, 폴드 카드 던지기, 카드 뒤집기(상대 쇼다운) 애니 없음.
- 사운드(전부 한국어 TTS): 내 차례 `turn`, 액션 ack 시 `fold`/`allin`/`chip`, 결과 `win`/`tie`/`lose` — `:148`, `:193`, `:125`, `:133`; 목록 `lib/sound.ts:6-20`, 파일 `apps/web/public/sounds/`. 설정은 전역 음소거 토글뿐(볼륨·진동·개별 없음) — `components/SoundToggle.tsx`.
- 채팅: 텍스트만, 이모트/던지기 없음 — `components/RoomChat.tsx`.

### 도움말 시트 (`lib/guides/holdem.tsx`, 셸 공통 `GameShell`/`GameGuide`)
- 탭 3개: 족보표(`HOLDEM_RANKINGS` 10행 카드 렌더), 게임 방법(6단계 + 버튼 5개 설명 + 20초 자동 체크/폴드 + 레이크 노트), 용어 8개 — `:29-88`. 셸의 도움말 버튼과 `openGameGuide("rankings")` 이벤트로 열림 — `components/GameShell.tsx:62-69`, `:126-129`.
- 서버 규칙과 대조:
  - "앉은 사람 모두 준비되면 시작 (2명 이상)" ✓ (`:461`)
  - "딜러 버튼 왼쪽 두 사람이 SB/BB", "BB 다음 사람부터" ✓ 단 **헤즈업 예외(버튼이 SB·프리플랍 선행)** 미기재
  - "20초 안에 선택 안 하면 자동 체크/폴드" ✓ (`:658-672`)
  - "레이크 5%, 상한 있음" ✓ (`holdem-service.ts:13-18`); 단 `docs/architecture.md:75`의 "3코인 상한"은 stale
  - **"나 빼고 전부 폴드하면 카드 공개 없이 내가 이겨요" ✗** — 서버는 폴드 승에도 승자 카드를 공개(`:700`, `:355`)
  - "콜: 잔액 부족하면 가진 만큼 내고 올인" ✓; "올인 이후 사이드팟" ✓
  - 미기재: 최소 레이즈 규칙, **스택 = 지갑 전체**라는 사실, 핸드 간 6초 휴식이 유일한 기립 창, 폴드 승 팟에도 레이크

### 기타 기능 유무
- 프리셀렉트(체크/폴드, 콜 애니): 없음 — 액션 UI는 `myTurn`일 때만 렌더 (`:327`).
- 핸드 히스토리: 게임 히스토리 페이지에 **핸드당 순손익 1행**(좌석 번호·베팅·결과)만, 카드/보드/액션 없음 — `main.ts:692-698`, `:722-731`, `pages/GameHistoryPage.tsx`. 리플레이 없음.
- 통계: 게임별 총 베팅/승/패/무 집계뿐 — `main.ts:734-745`. VPIP 등 없음.
- 로비 카드: `min–max 코인`, 인원(관전 포함), phase를 **enum 원문**(예 `PLAYER_TURN`)으로 노출 — `pages/LobbyPage.tsx:72-100`.

---

## A4. 표준 온라인 홀덤 대비 빠진 것 / 약점

| 기능 | 상태 | 근거·비고 |
|---|---|---|
| 타임뱅크 | **없음** | `ACTION_MS` 20s 고정, 연장 API 없음 — `holdem-room-manager.ts:55`, `:654-656` |
| 프리액션 체크박스 (Check/Fold, Call any) | **없음** | 액션 UI는 내 차례에만 — `HoldemRoomPage.tsx:327` |
| 자동 머크 (패자 카드 숨김) | **없음** (반대로 전원 공개) | `:355` |
| 카드 1장 보여주기 | **없음** | 액션 enum에 없음 — `contracts:413` |
| 핸드 히스토리 (카드·액션) | **부분** | 손익 1행만 — `main.ts:692-731`; 홀카드는 DB에도 안 남음(A5 #1) |
| 리플레이 | **없음** | — |
| 사이드팟 UI | **있음(부분)** | "메인 N · 사이드 N/N" 텍스트 — `HoldemRoomPage.tsx:258-260`; 팟별 자격 좌석(`eligibleSeats`)은 표시 안 함 |
| 팟 오즈 / 팟 크기 | **부분** | 팟 총액·콜 금액은 표시(`:257`, `:322-324`), 오즈/% 없음 |
| 레이즈 슬라이더 | **없음** | 프리셋+BB 스테퍼로 대체 — `:343-361` |
| BB 단위 표기 | **없음** | 전부 코인 단위 |
| 스트래들 | **없음** | — |
| 런잇트와이스 | **없음** | — |
| 올인 인슈어런스 | **없음** | — |
| 래빗 헌팅 | **없음** | — |
| 봄팟 | **없음** | — |
| 앤티 | **없음** | 블라인드만 — `:565-566` |
| 자리 비움(sit out) / 다음 핸드부터 참여 | **부분** | 자발적 sit-out 없음. 준비 취소는 sit-out이 아니라 **테이블 전체 정지**(`:456-461`); 핸드 중 착석자는 다음 핸드 자동 참여(`:511-513`, 안내 `:387`) |
| 웨이트 포 BB / 포스트 | **없음** | 새 착석자 즉시 딜인 — `:527-543` |
| 자동 리바이 / 탑업 | **해당 없음** | 바이인 개념 부재, 스택=지갑 — `:345` |
| 관전 모드 | **있음** | `:141-154`, `:303-308` |
| 테이블 이동 | **없음** | 로비 경유만 |
| 멀티테이블 | **없음** | 페이지당 소켓 1개·방 1개 — `HoldemRoomPage.tsx:49-74` |
| 토너먼트 / 싯앤고 | **없음** | `docs/roadmap.md:52` 미완료 |
| 이모티콘 / 던지기 | **없음** | 텍스트 채팅만 |
| 아바타 | **없음** | 닉네임 텍스트 — `:486` |
| 멀티 컬러 덱 | **없음** | `CardFace` 단일 스타일, 옵션 없음 |
| 테이블 통계 (VPIP 등) | **없음** | — |
| 담합 방지 | **부분** | 웨이저링 크레딧을 레이크 지분으로 제한(`holdem-service.ts:191-194`); 동일 IP/기기 검사 없음(`apps/api/src`에 IP 참조 없음); 홀카드 미저장으로 사후 감사 불가 |
| 접속 끊김 보호 | **없음** | 끊기면 타이머 만료 폴드 — `:156-182`, `:658-672`; 재접속 상태 복원은 됨 |
| 핸드 번호 / 시간 | **없음(UI)** | DB `round_number`는 있음(`:545-548`), 스냅샷엔 `roundId` uuid만 |
| 소리·진동 설정 | **부분** | 전역 음소거만 — `SoundToggle.tsx` |
| 오토 폴드/카드 애니메이션 | **없음** | 폴드는 `.is-folded` 투명도만 — `styles.css:4170`; 홀카드 딜 애니 없음(`:464`) |
| 칩 이동 애니메이션 | **부분** | 베팅 칩 팝만(`styles.css:4163`); 팟 수거/승자 지급 없음 |
| 좌석별 마지막 액션 라벨 / 액션 로그 | **없음** | 폴드·올인 상태만 — `:492-493` |
| 테이블 베팅 상한 / 바이인 상한 | **없음** | `max_bet`은 레이크 상한에만 — `:702`; UI는 "최대 N"이라 표기(`:226`) |
| 타임아웃 시 준비 안 한 좌석 정리 | **없음** | `allSeatedReady` 무기한 — `:456-461` |
| 헤즈업 규칙 안내 | **없음(도움말)** | 서버는 구현(`:541-543`, `:571`) |
| 핸드 강도/에퀴티 % | **부분** | 5단계 미터·드로우 문장(클라 계산) — `holdemHandRead.ts`; 승률 % 없음 |
| 키보드 단축키 | **없음** | — |

---

## A5. 코드 품질·버그 후보

TODO/FIXME: 홀덤 관련 파일 어디에도 없음(grep 결과 0건).

### 버그 후보 (심각도 순)

1. **[치명, 코드 정독상 확실] 홀카드가 DB에 절대 기록되지 않음 → 모든 쇼다운이 무승부 분할로 정산될 가능성**
   - `recordHoleCards`는 `UPDATE holdem_contributions SET hole_cards=…` (`holdem-service.ts:56-58`)인데, 호출 시점(`holdem-room-manager.ts:556-560`)에는 그 라운드의 `holdem_contributions` 행이 아직 없음. 행은 최초 `contribute()`의 INSERT(`holdem-service.ts:46-51`)로 생기고, 그 첫 호출은 홀카드 기록 **이후**인 블라인드 포스트(`:565-566`). 다른 INSERT 경로 없음(grep: `holdem_contributions` 쓰기 지점은 `:47`·`:57`·`:61`·`:65`·`:185`·`:291`뿐). 최초 커밋 `877de5f`부터 동일 순서.
   - 결과 (a): `settle()`이 DB 행의 `holeCards`(항상 `[]`)로 `evaluateBestHoldemHand([...[], ...board])`를 계산(`holdem-service.ts:94-96`) → 생존자 전원이 보드 5장 동일 족보 → **매 쇼다운 팟이 레이크 차감 후 균등 분할**. 인메모리 `handCategory`(`:364-366`)는 진짜 카드로 계산되므로 화면엔 서로 다른 족보가 뜨는데 둘 다 `WIN`.
   - 결과 (b): `recoverInterruptedRounds`의 `canSettle`(홀카드 2장 필요, `:247-249`)이 항상 false → "리버까지 진행한 핸드는 정산" 경로(`docs/roadmap.md:51`)가 사실상 데드코드, 전부 환불.
   - 정황 증거: 커밋 `051451d` 메시지 "tied Hold'em pots being silently recorded as a loss … showing no result banner" 및 클라이언트의 무승부 특수 처리(`HoldemRoomPage.tsx:112-125`)는 분할팟이 빈번히 관측됐음을 시사. 런타임 재현은 이 리서치에서 하지 않았으므로 **실행 검증 필요**.

2. **[높음, 추정] 2인 테이블에서 한 명이 파산하면 서버가 무한 비동기 루프**
   - `startHand`가 잔액 < SB 좌석을 `sittingOut`에 넣고 `seatedOrder.length < 2`면 그냥 return(`:523-528`) — `resetHandState`를 거치지 않아 좌석이 해제되지 않음. `launchCycle`의 `finally`가 `phase === "WAITING"`이면 즉시 재호출(`:472-475`), 조건(`seatedCount ≥ 2`, 전원 ready)은 그대로 참 → `startHand` 재진입 → 잔액 쿼리 2회 → return → 반복. 테이블은 멈춘 채 DB만 두드림.

3. **[중간] 분할팟 승자 `amount`가 음수** — `payout − contribution`(`holdem-service.ts:188`)이 레이크 때문에 음수. 계약은 `nonnegative`(`contracts:465`, 서버가 zod 검증을 안 해 통과), 화면엔 `WIN +-3` / `+-3`(`HoldemRoomPage.tsx:277`, `:293`), 승리자 피드에도 음수(`:415-421`).

4. **[중간] 숏스택의 "올인" 버튼이 서버에서 거절됨** — 클라는 `maxRaiseTo > 0`이면 올인 버튼 표시(`:377`), 서버는 `streetContributed + balance ≤ currentBet`이면 `RAISE_TOO_SMALL`(`:275-277`). 콜 금액도 못 덮는 플레이어는 "최소 레이즈 금액보다 적습니다" 에러를 보고 콜 버튼을 눌러야 함.

5. **[중간] 폴드 승 시 승자 홀카드 공개** — `showdown()`이 항상 `street="showdown"`(`:700`) → `:355` 조건으로 공개. 도움말(`guides/holdem.tsx:52`)과 표준 규칙 모두 위반, 상대에게 정보 노출.

6. **[중간] `max_bet`가 아무 한도도 아님** — UI 부제 "최대 5,000"(`:226`), 로비 "50–5,000 코인"(`LobbyPage.tsx:81-83`)이지만 서버는 베팅/바이인 상한을 두지 않음(`:274-293`에 검사 없음). 방 티어 차이는 블라인드·레이크 상한뿐. 지갑 전체가 항상 위험 노출.

7. **[낮음] 착석(BB) vs 핸드 시작(SB) 잔액 기준 불일치** — `:190` vs `:525`.

8. **[낮음] 끊긴 플레이어 때문에 매 턴 20초 대기** — `leave()`는 `sittingOut`만 표시(`:170-172`), 즉시 폴드는 `standUp`만(`:208-214`). 주석("folds when its turn comes")과 실제(타임아웃 경유) 불일치.

9. **[낮음] 숏 올인 후 이미 액션한 플레이어의 재레이즈 허용** — 재오픈 추적 없음(`:274-293`, `:681-688`).

10. **[낮음] 홀수 칩 분배가 좌석 위치가 아니라 DB 조회 순서** — `holdem-service.ts:133-136`.

11. **[낮음] 프리셋 수치가 표준 팟 레이즈와 다름** — "팟" = raise-to `potTotal`(`:212`), 콜 반영 안 함; 프리플랍 팟 3에서 쿼터/하프/팟 전부 MIN으로 클램프(`:203`).

12. **[낮음] RESULT 카운트다운 불일치** — `setPhase("RESULT", 5s)`(`:717`)지만 실제 대기는 4s일 수 있음(`:586`); SETTLING도 5s 라벨(`:701`)이나 즉시 넘어감.

13. **[낮음] 이중 정의·stale 주석/문서** — `ACTION_SECONDS=20` 클라 하드코딩(`HoldemRoomPage.tsx:28`); `shoeFlight.ts:4-5` "holdem은 슈 없음"(실제로는 `DeckShoe` 렌더, `:251`); `docs/architecture.md:75` "3코인 상한"(현재 `max_bet×3%`); 메모리 노트도 "5%-capped-at-3-coins".

14. **[낮음] `game_rounds.phase`가 홀덤에선 DEALING→RESULT만** — 스트리트/턴 단계 미기록(`:545-550`, `:716`), 바카라는 매 단계 기록(`room-manager.ts:318`). 관리자 뷰가 DB phase를 읽으면 stale (추정).

15. **[낮음] 로비가 phase enum 원문 노출** — `LobbyPage.tsx:75-77` (`PLAYER_TURN` 등).

16. **[낮음] `notification` 이벤트 미구독** — 서버가 핸드 중단 환불 알림을 보내지만(`:469-471`) 홀덤 페이지 소켓 핸들러에 없음(`HoldemRoomPage.tsx:61-64`) (추정: 상위 셸 처리 여부 미확인).

### 성능 우려
- 브로드캐스트당 DB 조회 `참가자 N × 7`(`emitSnapshots` `:405-410`, 좌석 `stack` `:345`, 뷰어 잔액 `:386`) + ack용 재조회(`:247`). 관전자가 늘수록 선형 증가, 액션·단계 전환·입퇴장마다 발생. 잔액을 한 번만 조회해 재사용하는 바카라식 최적화(`room-manager.ts:265-271`) 없음.
- `contribute()`마다 커넥션 획득+트랜잭션(`:296-316`), 이어서 `markAllIn`/`markFolded`는 별도 쿼리 — 액션당 2~3 라운드트립.
- 쇼다운 스냅샷의 `evaluateBestHoldemHand`는 좌석 6 × 참가자 N × 21조합 — 미미.

### 테스트 커버리지
- `packages/game-core/src/holdem.test.ts` (7 케이스): 휠 스트레이트/로열, 키커 비교, 메인/사이드팟(폴드 제외), 전원 폴드 슬라이스 `contributorUserIds`, `HOLDEM_RANKINGS` 자기검증·정렬, 티어(카테고리/프리플랍), 드로우 읽기(플랍/턴 한정).
- `apps/api/src/games/holdem/holdem-service.test.ts` (5 케이스): `rakeFor`만(5%, 내림, 상한 3% of max_bet, 1코인 방, 0팟).
- **없는 것**: 룸 액터 상태머신(블라인드/HU/버튼 회전/베팅 라운드 종료/최소 레이즈/숏 올인/타임아웃), `settle()` 원장 균형·분할·환불 슬라이스, `recoverInterruptedRounds`, 스냅샷 비공개 정보, 클라이언트 테스트 전무(`apps/web/src`에 `*.test.*` 0개). 위 #1·#2는 통합 테스트가 있었다면 잡혔을 유형.

### 구조 메모
- 홀덤/섯다/바카라/블랙잭/드래곤타이거 룸 매니저가 공통 베이스 없이 participants·presence·setPhase·emitSnapshots·launchCycle 패턴을 각각 복제 — 메모리 노트 `holdem-lightning-dragontiger-shipped.md`의 "shared-engine 미완" 그대로. 홀덤 개선 시 타임뱅크·sit-out·액션 로그 등은 액터에 필드를 더하는 식이 되고, 섯다와 중복이 더 커짐.
- 새 UI 요소는 펠트 오버레이가 아니라 `.holdem-rail-v4` 안에 넣는 것이 v4 설계 원칙(`table-holdem.css:1-19`, 메모리 `holdem-v4-redesign.md`).
- 워킹트리에 `table-holdem.css`/`table-pvp.css` 미커밋 변경 있음(색상 토큰 통일·폰트 크기 조정 위주, `git diff --stat` 72/94줄).
