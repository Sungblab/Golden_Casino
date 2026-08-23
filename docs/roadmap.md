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

- [ ] 공통 게임 계약 확장
- [ ] 좌석과 라운드 참가자
- [ ] Hit, Stand, Double
- [ ] 딜러 자동 행동과 타임아웃
- [ ] 원장 기반 블랙잭 정산
- [ ] 재접속과 중간 이탈 처리

## Later systems

- [ ] 회원 가입과 관리자 승인
- [ ] 충전·환전 요청
- [ ] 사용자 송금
- [ ] 베팅·원장 기록 화면
- [ ] 관리자 감사 로그 UI
- [ ] 채팅과 공지
- [ ] Redis 기반 수평 확장
