# Golden Casino Platform

Golden Casino의 React + TypeScript 차세대 플랫폼입니다. 기존 Vanilla JS/MongoDB 구현은 삭제하지 않고 [`reference/legacy`](./reference/legacy)에 보존되어 있습니다.

현재 첫 마일스톤은 다음 흐름을 실제로 연결합니다.

```text
로그인 → 게임 로비 → 한도별 바카라 방 → 자동 라운드 → 원장 기반 베팅·정산
```

## 기술 구성

- `apps/web`: React, Vite, Socket.IO Client
- `apps/api`: Express, Socket.IO, PostgreSQL
- `packages/contracts`: 프론트·백엔드 공통 타입과 Zod 계약
- `packages/game-core`: 외부 의존성 없는 바카라 규칙 엔진
- `reference/legacy`: 기존 Golden Casino 프론트·백엔드와 HTML 프로토타입

코인은 PostgreSQL `BIGINT` minor unit으로 기록되며 1코인은 내부적으로 100단위입니다. 모든 코인 이동은 합계가 0인 원장 엔트리로 처리됩니다.

## 로컬 실행

```bash
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

- React: http://127.0.0.1:5173
- API: http://127.0.0.1:5100
- 개발 계정: `demo` / `demo1234`

## 검증

```bash
npm run check
```

자세한 설계와 진행 범위는 [`docs/architecture.md`](./docs/architecture.md), [`docs/roadmap.md`](./docs/roadmap.md)를 참고하세요.

> 포트폴리오 및 학습용 코인 데모입니다. 실제 금전 거래나 도박 서비스를 제공하지 않습니다.
