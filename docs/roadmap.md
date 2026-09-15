# Roadmap

## Milestone 1 — Platform foundation and Baccarat vertical slice

- [x] 레거시 프론트·백엔드 보존 이동
- [x] React + TypeScript 모노레포
- [x] 프론트·백엔드 공통 계약
- [x] PostgreSQL 사용자·방·라운드·베팅 스키마
- [x] 복식 코인 원장
- [x] 로그인과 개발 계정
- [x] 게임 로비와 한도별 바카라 방 3개
- [x] 서버 권위형 자동 바카라 라운드
- [x] 실제 베팅 접수·정산·잔액 실시간 반영
- [x] 데스크톱·모바일 React UI

## Milestone 2 — Baccarat hardening

- [x] 프로세스 재시작 시 미정산 베팅 환불 및 라운드 중단 처리
- [ ] 프로세스 재시작 후 라운드 중단 지점 자동 재개
- [ ] 트랜잭션 outbox와 이벤트 재전송
- [x] 베팅 취소 (`bet.cancel`, 베팅 마감 전에만 허용, 원장 환불)
- [x] 리핏 벳 (직전 라운드에 낸 베팅을 다음 베팅 타임에 그대로 재현, 클라이언트 사이드)
- [x] 슈 잔여 카드 수, 로드맵(빅로드), 최근 결과 영속화·실시간 반영
- [x] 관리자 방 일시정지·재개 (`POST /api/v1/admin/rooms/:id/pause|resume`, `admin` 역할 전용)
- [ ] 다중 사용자·동시 베팅 부하 테스트
- [x] Refresh Token과 세션 폐기 (HttpOnly 쿠키 + 회전 + `/auth/logout` 폐기)

### 이번 라운드에 추가된 UX

- [x] Big Road 스코어보드 + 승률 통계 스트립 (`packages/game-core/src/big-road.ts`)
- [x] 카드 딜링 · 칩 배팅 애니메이션, 라운드 사운드 이펙트
- [x] 베팅 화면 컴포넌트 분리 (`apps/web/src/pages`, `apps/web/src/components`)
- [x] 지갑 거래 내역 화면 (`/wallet`)

## Milestone 3 — Blackjack

- [x] 공통 게임 계약 확장
- [x] 좌석과 라운드 참가자 (7석, 뒷전 베팅)
- [x] Hit, Stand, Double, Split, Surrender, Insurance
- [x] 딜러 자동 행동과 타임아웃
- [x] 원장 기반 블랙잭 정산
- [x] 재접속과 중간 이탈 처리 (좌석 유지, 처리 실패 시 환불)

## Milestone 4 — Dragon Tiger, Lightning variants, Hold'em PvP

- [x] 드래곤 타이거 (`apps/api/src/games/rooms/dragon-tiger-room-manager.ts`) — 8덱, 자동 라운드, 바카라 정산 서비스 재사용
- [x] 라이트닝 바카라 — 기존 바카라 방에 20% 앤티 수수료 + 라운드별 가상 카드 1~5장(2x~8x 배수) 추가
- [x] 라이트닝 블랙잭 — 최초 베팅 100% 수수료, 승리 시 다음 라운드 이익에만 적용되는 2x~25x 배수(180일 만료로 영속화)
- [x] 텍사스 홀덤 PvP 6-max (`apps/api/src/games/rooms/holdem-room-manager.ts`) — 좌석, 딜러 버튼 로테이션, 블라인드, 스트리트별 순차 베팅, 사이드팟, 쇼다운(`evaluateBestHoldemHand`/`buildHoldemPots`). 하우스가 상대가 아니므로 팟은 방 예치 계정에 쌓였다가 정산 시 승자에게 분배되고(레이크 5%, 3코인 상한 제외) 패자 몫이 하우스로 가지 않는다.
- [x] 홀덤 다중 테이블 (Micro/Standard/High Roller 3개 한도별 방)
- [x] 홀덤 프로세스 재시작 시 리버까지 진행된 핸드는 저장된 보드로 정산 완료(환불 아님); 리버 전 중단은 여전히 전액 환불 — 슈의 남은 카드 순서는 프로세스 메모리에만 있고 절대 영속화하지 않으므로(영속화하면 DB 접근 권한이 곧 카드 순서 열람 권한이 되어 담합 도구가 됨) 그 이전 중단은 원리적으로 재개 불가능
- [ ] 홀덤 토너먼트

## Milestone 5 — 초보자 친화 UX와 모바일 반응형 (섯다·홀덤 중심)

- [x] 게임별 도움말 시트 (`apps/web/src/components/GameGuide.tsx`, `apps/web/src/lib/guides/`) — 모든 테이블의 게임 바 같은 자리에 `도움말` 버튼. 족보표(실제 화투·카드 이미지) · 게임 방법 · 버튼 설명 · 용어. 첫 방문 시 1회 안내 말풍선 (`localStorage`)
- [x] 섯다 족보 참조 데이터와 강도 계산 (`packages/game-core/src/sutda.ts`: `SUTDA_RANKINGS`, `SUTDA_SPECIALS`, `sutdaHandStrength`, `sutdaSecondCardOutlook`) — 가능한 190개 조합 대비 순위, 첫 패만 있을 때 "노려볼 패"
- [x] 홀덤 족보 참조 데이터와 읽기 (`packages/game-core/src/holdem.ts`: `HOLDEM_RANKINGS`, `holdemCategoryTier`, `holdemPreflopTier`, `readHoldemDraws`) — 5단계 강도, 플러시·스트레이트 드로우 안내
- [x] 섯다·홀덤 테이블 레일 개편 — 진행 단계 바, 내 족보 패널(강도 미터), "내 차례" 스트립, 버튼마다 한 줄 설명(포기하기·따라가기·올리기…), 선/D·SB·BB 배지, 쇼다운 족보 공개, 패배 시 어떤 패에 졌는지 안내
- [x] 섯다·홀덤·블랙잭 세로 모드 지원 — 가로 강제 오버레이(`OrientationGate`) 제거. PvP 테이블은 세로 화면에서 테이블 위·액션 독 아래 배치 (`apps/web/src/styles/table-pvp.css`, 좌석 좌표는 `--sx/--sy` CSS 변수로 레이아웃별 반지름 분리)
- [x] 로직 검증 — 땡잡이가 광땡보다 이기던 판정 수정(`resolveSutdaWinners`), 판 중간 착석 좌석이 베팅 루프·쇼다운을 깨던 문제(섯다 `active()`/홀덤 `contenderSeats()`는 카드를 받은 좌석만), 진행 중 자리 비우기는 즉시 다이/폴드 처리, PvP 오류 코드 한글 메시지
- [ ] 튜토리얼 모드 (봇 상대 연습 판)

## Later systems

- [ ] 회원 가입과 관리자 승인
- [ ] 충전·환전 요청
- [x] 사용자 송금
- [ ] 베팅·원장 기록 화면
- [ ] 관리자 감사 로그 UI
- [x] 채팅과 공지
- [ ] Redis 기반 수평 확장
