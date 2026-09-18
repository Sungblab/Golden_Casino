# G. 메인 에이전트 직접 검증 (2026-09-18)

## G1. 홀덤 쇼다운 정산 치명 버그 — 코드 정독으로 확정

- `apps/api/src/games/rooms/holdem-room-manager.ts:556-560`: 라운드 INSERT 직후 홀카드를 `holdemService.recordHoleCards()`로 기록. 이 함수는 `UPDATE holdem_contributions SET hole_cards=… WHERE round_id AND user_id` (`holdem-service.ts:56-58`).
- 그 시점에 해당 라운드의 `holdem_contributions` 행은 존재하지 않음. 행은 `contribute()`의 INSERT … ON CONFLICT(`holdem-service.ts:46-51`)로만 생기고, 첫 호출은 그 뒤의 블라인드 포스트(`holdem-room-manager.ts:565-566`). → UPDATE 0행, 홀카드는 영구히 `'[]'`.
- `settle()`은 DB 행의 `holeCards`(빈 배열)와 보드만으로 `evaluateBestHoldemHand([...[], ...board])`(`holdem-service.ts:94-96`)를 계산. 평가기는 5~7장을 받으며 5장이면 예외 없이 보드 자체를 평가(`packages/game-core/src/holdem.ts:114-117`). → 생존자 전원 동일 족보 → 매 쇼다운 팟이 레이크 차감 후 균등 분할.
- 정황: 커밋 `051451d`(09-17) "tied Hold'em pots being silently recorded as a loss" 는 이 증상(무승부가 비정상적으로 잦음)을 UI/통계 라벨 차원에서 다룬 것으로 보임. 근본 원인(홀카드 미저장)은 그대로.
- 파급: (a) 실력·카드와 무관하게 쇼다운은 항상 찹 → 게임 성립 불가 수준, (b) 재시작 복구의 "리버까지 진행한 핸드 정산" 경로(`recoverInterruptedRounds`, 홀카드 2장 필요)가 데드코드, (c) 사후 감사 불가.
- 수정 방향(개선 단계에서): 딜 시점에 `INSERT … ON CONFLICT DO UPDATE SET hole_cards`로 행을 만들거나, 섯다처럼 액터 메모리의 카드로 승자를 결정하고 DB는 기록용으로만 쓰기. 통합 테스트(2인 쇼다운에서 강한 패가 이기는지) 필수.
- 런타임 재현은 이 리서치에서 하지 않음(정적 근거만으로 충분히 확정적이나, 수정 후 dev 계정 2개로 쇼다운 1회 검증 권장 — [[dev-test-accounts]] 절차).

## G2. 섯다는 이 버그와 무관

- `sutda-room-manager.ts` `showdown()`은 액터 메모리의 `seat.cards`로 `resolveSutdaWinners(active)`를 계산해 `sutdaService.settle(roomId, roundId, winnerIds, maxBet, takeRake)`에 승자 ID를 넘김. DB 카드에 의존하지 않음.
