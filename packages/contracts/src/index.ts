import { z } from "zod";

export const gameTypeSchema = z.enum(["baccarat", "blackjack"]);
export type GameType = z.infer<typeof gameTypeSchema>;

export const roomPhaseSchema = z.enum([
  "WAITING",
  "BETTING",
  "LOCKED",
  "DEALING",
  // Blackjack-only phases: players act on their own hands, then the dealer plays out.
  "PLAYER_TURN",
  "DEALER_TURN",
  "SETTLING",
  "RESULT",
]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

export const baccaratBetChoiceSchema = z.enum([
  "player",
  "banker",
  "tie",
  "player_pair",
  "banker_pair",
]);
export type BaccaratBetChoice = z.infer<typeof baccaratBetChoiceSchema>;

export const cardSchema = z.object({
  rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]),
  suit: z.enum(["S", "H", "D", "C"]),
});
export type Card = z.infer<typeof cardSchema>;

export const roundResultSchema = z.enum(["player", "banker", "tie"]);
export type RoundResult = z.infer<typeof roundResultSchema>;

/** One settled round's outcome plus the pair side-bet flags, used to draw the road maps. */
export const roundHistoryEntrySchema = z.object({
  result: roundResultSchema,
  playerPair: z.boolean(),
  bankerPair: z.boolean(),
});
export type RoundHistoryEntry = z.infer<typeof roundHistoryEntrySchema>;

export const gameRoomSchema = z.object({
  id: z.string().uuid(),
  gameType: gameTypeSchema,
  code: z.string(),
  name: z.string(),
  minBet: z.number().int().positive(),
  maxBet: z.number().int().positive(),
  playerCount: z.number().int().nonnegative(),
  phase: roomPhaseSchema,
  enabled: z.boolean(),
  paused: z.boolean(),
  /** Recent round outcomes for the lobby's Big Road preview. Baccarat rooms only; omitted/empty for blackjack. */
  recentResults: z.array(roundHistoryEntrySchema).optional(),
});
export type GameRoom = z.infer<typeof gameRoomSchema>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(["user", "admin"]),
});
export type PublicAuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const lobbyResponseSchema = z.object({
  rooms: z.array(gameRoomSchema),
  walletBalance: z.number().int().nonnegative(),
});
export type LobbyResponse = z.infer<typeof lobbyResponseSchema>;

export const adminUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(["user", "admin"]),
  approved: z.boolean(),
  createdAt: z.string(),
  balance: z.number().int(),
  totalBets: z.number().int().nonnegative(),
  totalWagered: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminHouseStatsSchema = z.object({
  balance: z.number().int(),
  totalWagered: z.number().int().nonnegative(),
  houseProfit: z.number().int(),
  settledWagers: z.number().int().nonnegative(),
  activeBettors: z.number().int().nonnegative(),
  totalRounds: z.number().int().nonnegative(),
  playerRounds: z.number().int().nonnegative(),
  bankerRounds: z.number().int().nonnegative(),
  tieRounds: z.number().int().nonnegative(),
});
export type AdminHouseStats = z.infer<typeof adminHouseStatsSchema>;

export const adminOverviewSchema = z.object({
  walletBalance: z.number().int().nonnegative(),
  rooms: z.array(gameRoomSchema),
  users: z.array(adminUserSchema),
  house: adminHouseStatsSchema,
  pendingCashRequests: z.object({ count: z.number().int().nonnegative(), amount: z.number().int().nonnegative() }),
  openSupportConversations: z.number().int().nonnegative(),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const roomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  phaseEndsAt: z.string().datetime().nullable(),
  playerCards: z.array(cardSchema),
  bankerCards: z.array(cardSchema),
  playerScore: z.number().int().min(0).max(9).nullable(),
  bankerScore: z.number().int().min(0).max(9).nullable(),
  result: roundResultSchema.nullable(),
  playerPair: z.boolean(),
  bankerPair: z.boolean(),
  myBets: z.record(baccaratBetChoiceSchema, z.number().int().nonnegative()),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(roundHistoryEntrySchema),
  shoeRemaining: z.number().int().nonnegative(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const placeBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: baccaratBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type PlaceBetCommand = z.infer<typeof placeBetCommandSchema>;

export const cancelBetCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: baccaratBetChoiceSchema,
});
export type CancelBetCommand = z.infer<typeof cancelBetCommandSchema>;

// ---------------------------------------------------------------------------
// Blackjack: one hand per seated player against a shared dealer hand. Players
// act on their own hand independently (no turn order) during PLAYER_TURN; the
// dealer then plays out and every hand settles together. No split/insurance yet.
// ---------------------------------------------------------------------------

export const blackjackHandStatusSchema = z.enum(["playing", "stand", "bust", "blackjack", "doubled"]);
export type BlackjackHandStatus = z.infer<typeof blackjackHandStatusSchema>;

export const blackjackOutcomeSchema = z.enum(["win", "lose", "push", "blackjack"]);
export type BlackjackOutcome = z.infer<typeof blackjackOutcomeSchema>;

export const blackjackActionSchema = z.enum(["hit", "stand", "double"]);
export type BlackjackAction = z.infer<typeof blackjackActionSchema>;

export const blackjackPlayerHandSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  cards: z.array(cardSchema),
  bet: z.number().int().positive(),
  status: blackjackHandStatusSchema,
  outcome: blackjackOutcomeSchema.nullable(),
});
export type BlackjackPlayerHand = z.infer<typeof blackjackPlayerHandSchema>;

export const blackjackRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  phaseEndsAt: z.string().datetime().nullable(),
  dealerCards: z.array(cardSchema),
  dealerScore: z.number().int().min(0).nullable(),
  /** True while the dealer's second card is still face-down (during BETTING/LOCKED/PLAYER_TURN). */
  dealerHoleHidden: z.boolean(),
  hands: z.array(blackjackPlayerHandSchema),
  myBet: z.number().int().nonnegative(),
  myHand: blackjackPlayerHandSchema.nullable(),
  walletBalance: z.number().int().nonnegative(),
  shoeRemaining: z.number().int().nonnegative(),
});
export type BlackjackRoomSnapshot = z.infer<typeof blackjackRoomSnapshotSchema>;

export const blackjackBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type BlackjackBetCommand = z.infer<typeof blackjackBetCommandSchema>;

export const blackjackActionCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  action: blackjackActionSchema,
});
export type BlackjackActionCommand = z.infer<typeof blackjackActionCommandSchema>;

export const walletTransactionItemSchema = z.object({
  id: z.string(),
  transaction_type: z.string(),
  reference_type: z.string().nullable(),
  created_at: z.string(),
  amount_minor: z.number().int(),
});
export type WalletTransactionItem = z.infer<typeof walletTransactionItemSchema>;

export const walletTransactionsResponseSchema = z.object({
  items: z.array(walletTransactionItemSchema),
});
export type WalletTransactionsResponse = z.infer<typeof walletTransactionsResponseSchema>;

export const cashRequestTypeSchema = z.enum(["deposit", "withdraw"]);
export type CashRequestType = z.infer<typeof cashRequestTypeSchema>;
export const cashRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);
export type CashRequestStatus = z.infer<typeof cashRequestStatusSchema>;
export const adminCashRequestSchema = z.object({
  id: z.string().uuid(),
  request_type: cashRequestTypeSchema,
  amount: z.number().int().positive(),
  status: cashRequestStatusSchema,
  created_at: z.string(),
  username: z.string(),
});
export type AdminCashRequest = z.infer<typeof adminCashRequestSchema>;
export const cashRequestSchema = z.object({
  id: z.string().uuid(),
  type: cashRequestTypeSchema,
  amount: z.number().int().positive(),
  status: cashRequestStatusSchema,
  createdAt: z.string(),
});
export type CashRequest = z.infer<typeof cashRequestSchema>;

export const profileStatsSchema = z.object({
  totalWagered: z.number().int().nonnegative(),
  settledWagered: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  pushes: z.number().int().nonnegative(),
  netResult: z.number().int(),
});
export type ProfileStats = z.infer<typeof profileStatsSchema>;

export const profileResponseSchema = z.object({
  user: authUserSchema,
  walletBalance: z.number().int().nonnegative(),
  stats: profileStatsSchema,
  cashRequests: z.array(cashRequestSchema),
  transactions: z.array(walletTransactionItemSchema),
  recipients: z.array(z.object({ username: z.string() })),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const cashRequestCreateSchema = z.object({
  type: cashRequestTypeSchema,
  amount: z.number().int().positive(),
});
export type CashRequestCreate = z.infer<typeof cashRequestCreateSchema>;

export const transferCreateSchema = z.object({
  requestId: z.string().uuid(),
  recipientUsername: z.string().min(2).max(40),
  amount: z.number().int().positive(),
});
export type TransferCreate = z.infer<typeof transferCreateSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  username: z.string(),
  role: z.enum(["user", "admin"]),
  message: z.string().min(1).max(500),
  highlighted: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatHistoryResponseSchema = z.object({ items: z.array(chatMessageSchema) });
export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;

export const supportConversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  status: z.enum(["open", "closed"]),
  lastMessage: chatMessageSchema.nullable(),
  updatedAt: z.string(),
});
export type SupportConversation = z.infer<typeof supportConversationSchema>;

export const supportConversationListSchema = z.object({ items: z.array(supportConversationSchema) });
export type SupportConversationList = z.infer<typeof supportConversationListSchema>;

export const winnerFeedEntrySchema = z.object({
  id: z.string(),
  roomId: z.string().uuid(),
  game: z.enum(["baccarat", "blackjack"]),
  maskedUsername: z.string(),
  choiceLabel: z.string(),
  amount: z.number().int().positive(),
  createdAt: z.string(),
});
export type WinnerFeedEntry = z.infer<typeof winnerFeedEntrySchema>;

export type SocketAck<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export interface ServerToClientEvents {
  "room.snapshot": (snapshot: RoomSnapshot) => void;
  "room.presence": (payload: { roomId: string; playerCount: number }) => void;
  "room.chat.message": (message: ChatMessage) => void;
  "room.winners": (payload: { entries: WinnerFeedEntry[] }) => void;
  "support.message": (message: ChatMessage) => void;
  "wallet.updated": (payload: { balance: number }) => void;
  "notification": (payload: { type: "success" | "error" | "info"; message: string }) => void;
  "blackjack.snapshot": (snapshot: BlackjackRoomSnapshot) => void;
}

export interface ClientToServerEvents {
  "room.join": (payload: { roomId: string }, ack: (response: SocketAck<RoomSnapshot>) => void) => void;
  "room.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "bet.place": (payload: PlaceBetCommand, ack: (response: SocketAck<RoomSnapshot>) => void) => void;
  "bet.cancel": (payload: CancelBetCommand, ack: (response: SocketAck<RoomSnapshot>) => void) => void;
  "room.chat.send": (payload: { roomId: string; message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "support.send": (payload: { message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "admin.support.send": (payload: { conversationId: string; message: string }, ack: (response: SocketAck<ChatMessage>) => void) => void;
  "blackjack.join": (payload: { roomId: string }, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "blackjack.bet": (payload: BlackjackBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.action": (payload: BlackjackActionCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
}

export const COIN_SCALE = 100;
