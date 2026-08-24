/**
 * Human-readable label for every ledger transaction `type` the server writes (see the
 * `type: "..."` literals across wallet-service.ts, bet-service.ts and hand-service.ts).
 * Single source of truth for both WalletPage and ProfilePage — the two drifted apart
 * before (Baccarat's BET_* types were mapped, Blackjack's BJ_* types were not) because
 * each page kept its own copy. Keep this list exhaustive: an unmapped type falls back to
 * showing the raw server code, which is the tell that a new transaction type needs adding here.
 */
export const TRANSACTION_LABEL: Record<string, string> = {
  OPENING_BALANCE: "초기 지급",
  DEPOSIT_APPROVED: "충전 승인",
  WITHDRAW_APPROVED: "환전 승인",
  USER_TRANSFER: "개인 송금",

  // Baccarat
  BET_RESERVED: "베팅 접수",
  BET_SETTLED: "라운드 정산",
  BET_REFUNDED: "라운드 중단 환불",
  BET_CANCELLED: "베팅 취소",

  // Blackjack — main hand
  BJ_BET_RESERVED: "블랙잭 베팅 접수",
  BJ_HAND_SETTLED: "블랙잭 정산",
  BJ_HAND_REFUNDED: "블랙잭 라운드 중단 환불",
  BJ_DOUBLE_RESERVED: "블랙잭 더블다운",
  BJ_SPLIT_RESERVED: "블랙잭 스플릿",

  // Blackjack — bet behind (following another seat)
  BJ_BEHIND_RESERVED: "따라 베팅 접수",
  BJ_BEHIND_SETTLED: "따라 베팅 정산",
  BJ_BEHIND_REFUNDED: "따라 베팅 환불",

  // Blackjack — insurance
  BJ_INSURANCE_RESERVED: "보험 베팅 접수",
  BJ_INSURANCE_SETTLED: "보험 정산",
  BJ_INSURANCE_REFUNDED: "보험 환불",
};
