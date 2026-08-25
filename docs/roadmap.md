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
- [ ] 홀덤 재접속·프로세스 재시작 중 진행 중 핸드 자동 재개 (현재는 프로세스 내 크래시·재시작 모두 핸드를 환불·중단 처리)
- [ ] 홀덤 다중 테이블·토너먼트

## Later systems

- [ ] 회원 가입과 관리자 승인
- [ ] 충전·환전 요청
- [x] 사용자 송금
- [ ] 베팅·원장 기록 화면
- [ ] 관리자 감사 로그 UI
- [x] 채팅과 공지
- [ ] Redis 기반 수평 확장
