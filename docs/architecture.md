# Architecture

## 원칙

1. 클라이언트는 화면과 사용자 명령만 담당하고, 게임 상태와 정산은 서버가 결정한다.
2. 게임별 규칙은 HTTP, Socket.IO, DB와 분리된 순수 TypeScript 패키지로 둔다.
3. 코인 잔액을 직접 수정하지 않고 항상 복식 원장 거래를 기록한다.
4. 모든 베팅 명령은 `requestId`로 멱등 처리한다.
5. 처음에는 모듈러 모놀리스로 운영하고, 규모가 커질 때 게임 워커를 분리한다.

## 런타임 경계

```text
React Web
   │ REST + Socket.IO
API / Realtime Gateway
   ├─ Auth
   ├─ Lobby / Rooms
   ├─ Wallet Ledger
   └─ Game Orchestrator
         └─ Baccarat Core
   │
PostgreSQL
```

## 방 상태

```text
WAITING → BETTING → LOCKED → DEALING → SETTLING → RESULT
   ↑                                                    │
   └──────── 방에 사용자가 있을 때 다음 라운드 ─────────┘
```

- 첫 사용자가 입장하면 베팅 카운트다운이 시작된다.
- 베팅이 없으면 카드를 소비하지 않고 다음 대기/베팅 상태로 이동한다.
- 사용자가 모두 나가도 이미 확정된 베팅은 정산한다.
- 빈 방에서는 새 라운드를 시작하지 않는다.

## 코인 원장

베팅 접수:

```text
사용자 계정 -stake
방 예치 계정 +stake
```

패배 정산:

```text
방 예치 계정 -stake
하우스 계정 +stake
```

승리 정산:

```text
방 예치 계정 -stake
하우스 계정 -(payout - stake)
사용자 계정 +payout
```

각 `ledger_transaction`의 `ledger_entries.amount_minor` 합계는 반드시 0이어야 한다. 라운드의 모든 베팅 정산은 하나의 PostgreSQL 트랜잭션으로 처리한다.

## 인증

- Access Token(JWT, 30분)은 `sessionStorage`에 보관하고 매 API/Socket 요청에 `Authorization: Bearer`로 전달한다.
- Refresh Token은 `HttpOnly` + `SameSite=Lax` 쿠키(`golden_rt`, `/api/v1/auth` 경로 한정)로만 전달되며 `refresh_tokens` 테이블에 `jti` 단위로 기록된다.
- `POST /api/v1/auth/refresh`는 매 호출마다 기존 `jti`를 폐기하고 새 refresh 토큰을 발급하는 회전(rotation) 방식이다. 프론트엔드는 로그인 후 20분마다 자동으로 이 엔드포인트를 호출해 세션을 이어간다.
- `POST /api/v1/auth/logout`은 현재 refresh 토큰을 즉시 폐기한다.

## 현재 한계

- 룸 액터는 현재 단일 API 프로세스 메모리에 존재한다.
- 프로세스 재시작 시 미정산 베팅은 전액 환불하고 라운드를 `ABORTED` 처리한다. 중단 지점 자동 재개는 다음 마일스톤이다.
- 방 일시정지 상태(`paused`)는 액터 메모리에만 있어 프로세스 재시작 시 초기화된다. 영속화는 다음 마일스톤이다.
- Redis 어댑터와 다중 서버 룸 소유권 잠금은 수평 확장 시 추가한다.
