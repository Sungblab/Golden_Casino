import { z } from "zod";

export const gameTypeSchema = z.enum([
  "baccarat",
  "lightning_baccarat",
  "dragon_tiger",
  "blackjack",
  "lightning_blackjack",
  "holdem",
  "sutda",
]);
export type GameType = z.infer<typeof gameTypeSchema>;

export const roomPhaseSchema = z.enum([
  "WAITING",
  "BETTING",
  "LOCKED",
  "DEALING",
  // Blackjack-only phases: players act on their own hands, then the dealer plays out.
  "INSURANCE",
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

/** Live, room-wide (not just mine) view of who's backing each zone this round — amount is coins, not minor units. */
export const betZoneTotalSchema = z.object({ amount: z.number().int().nonnegative(), players: z.number().int().nonnegative() });
export type BetZoneTotal = z.infer<typeof betZoneTotalSchema>;

export const dragonTigerBetChoiceSchema = z.enum(["dragon", "tiger", "tie", "suited_tie"]);
export type DragonTigerBetChoice = z.infer<typeof dragonTigerBetChoiceSchema>;

export const cardSchema = z.object({
  rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]),
  suit: z.enum(["S", "H", "D", "C"]),
});
export type Card = z.infer<typeof cardSchema>;

export const lightningCardSchema = z.object({
  card: cardSchema,
  multiplier: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(8)]),
});
export type LightningCardSnapshot = z.infer<typeof lightningCardSchema>;

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
  /** Lower cap for high-payout proposition bets (Player/Banker Pair, Suited Tie). Null if the
   * room has no side bets, or none narrower than maxBet. */
  sideBetMax: z.number().int().positive().nullable().optional(),
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
  nickname: z.string(),
  role: z.enum(["user", "admin"]),
});
export type PublicAuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const registerRequestSchema = z.object({
  username: z.string().min(2).max(40),
  nickname: z.string().min(2).max(20),
  password: z.string().min(8).max(100),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerResponseSchema = z.object({ status: z.literal("pending") });
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

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
  wageringRemaining: z.number().int().nonnegative(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminHouseStatsSchema = z.object({
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

export const adminHouseByGameSchema = z.object({
  game: gameTypeSchema,
  totalWagered: z.number().int().nonnegative(),
  houseProfit: z.number().int(),
  settledBets: z.number().int().nonnegative(),
});
export type AdminHouseByGame = z.infer<typeof adminHouseByGameSchema>;

export const adminTrendDaySchema = z.object({
  date: z.string(),
  bets: z.number().int().nonnegative(),
  wagered: z.number().int().nonnegative(),
  houseProfit: z.number().int(),
});
export type AdminTrendDay = z.infer<typeof adminTrendDaySchema>;

export const adminCashFlowSchema = z.object({
  totalDeposits: z.number().int().nonnegative(),
  totalWithdrawals: z.number().int().nonnegative(),
  netFlow: z.number().int(),
});
export type AdminCashFlow = z.infer<typeof adminCashFlowSchema>;

export const adminOverviewSchema = z.object({
  rooms: z.array(gameRoomSchema),
  users: z.array(adminUserSchema),
  house: adminHouseStatsSchema,
  houseByGame: z.array(adminHouseByGameSchema),
  recentTrend: z.array(adminTrendDaySchema),
  cashFlow: adminCashFlowSchema,
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
  betTotals: z.record(baccaratBetChoiceSchema, betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  recentResults: z.array(roundHistoryEntrySchema),
  shoeRemaining: z.number().int().nonnegative(),
  lightningCards: z.array(lightningCardSchema).max(5).optional(),
  lightningFeePercent: z.union([z.literal(0), z.literal(20)]).optional(),
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

export const dragonTigerResultSchema = z.enum(["dragon", "tiger", "tie"]);
export type DragonTigerResult = z.infer<typeof dragonTigerResultSchema>;

/** One settled round's outcome, used to draw the Dragon Tiger road map. */
export const dragonTigerHistoryEntrySchema = z.object({
  result: dragonTigerResultSchema,
  suitedTie: z.boolean(),
});
export type DragonTigerHistoryEntry = z.infer<typeof dragonTigerHistoryEntrySchema>;

export const dragonTigerRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  phaseEndsAt: z.string().datetime().nullable(),
  dragonCard: cardSchema.nullable(),
  tigerCard: cardSchema.nullable(),
  result: dragonTigerResultSchema.nullable(),
  suitedTie: z.boolean(),
  myBets: z.record(dragonTigerBetChoiceSchema, z.number().int().nonnegative()),
  betTotals: z.record(dragonTigerBetChoiceSchema, betZoneTotalSchema),
  walletBalance: z.number().int().nonnegative(),
  shoeRemaining: z.number().int().nonnegative(),
  recentResults: z.array(dragonTigerHistoryEntrySchema),
});
export type DragonTigerRoomSnapshot = z.infer<typeof dragonTigerRoomSnapshotSchema>;

export const dragonTigerBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: dragonTigerBetChoiceSchema,
  amount: z.number().int().positive(),
});
export type DragonTigerBetCommand = z.infer<typeof dragonTigerBetCommandSchema>;

export const dragonTigerCancelCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  choice: dragonTigerBetChoiceSchema,
});
export type DragonTigerCancelCommand = z.infer<typeof dragonTigerCancelCommandSchema>;

// ---------------------------------------------------------------------------
// Blackjack: seven seats share a dealer. A seat may hold up to four hands after
// splits, while insurance remains a separate wager against dealer blackjack.
// ---------------------------------------------------------------------------

export const blackjackHandStatusSchema = z.enum(["playing", "stand", "bust", "blackjack", "doubled", "surrendered"]);
export type BlackjackHandStatus = z.infer<typeof blackjackHandStatusSchema>;

export const blackjackOutcomeSchema = z.enum(["win", "lose", "push", "blackjack", "surrender"]);
export type BlackjackOutcome = z.infer<typeof blackjackOutcomeSchema>;

export const blackjackActionSchema = z.enum(["hit", "stand", "double", "split", "surrender"]);
export type BlackjackAction = z.infer<typeof blackjackActionSchema>;

export const blackjackPlayerHandSchema = z.object({
  handId: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  seatNumber: z.number().int().min(1).max(7),
  handIndex: z.number().int().min(0).max(3),
  fromSplit: z.boolean(),
  splitAces: z.boolean(),
  cards: z.array(cardSchema),
  bet: z.number().int().positive(),
  status: blackjackHandStatusSchema,
  outcome: blackjackOutcomeSchema.nullable(),
});
export type BlackjackPlayerHand = z.infer<typeof blackjackPlayerHandSchema>;

export const blackjackBehindBetSnapshotSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  targetSeat: z.number().int().min(1).max(7),
  amount: z.number().int().positive(),
  outcome: blackjackOutcomeSchema.nullable(),
});
export type BlackjackBehindBetSnapshot = z.infer<typeof blackjackBehindBetSnapshotSchema>;

export const blackjackInsuranceSnapshotSchema = z.object({
  amount: z.number().int().positive(),
  outcome: z.enum(["win", "lose"]).nullable(),
});
export type BlackjackInsuranceSnapshot = z.infer<typeof blackjackInsuranceSnapshotSchema>;

export const blackjackSeatSnapshotSchema = z.object({
  seatNumber: z.number().int().min(1).max(7),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  hand: blackjackPlayerHandSchema.nullable(),
  hands: z.array(blackjackPlayerHandSchema).max(4),
  behindBetTotal: z.number().int().nonnegative(),
  behindBetCount: z.number().int().nonnegative(),
  myBehindBet: z.number().int().nonnegative(),
  winStreak: z.number().int().nonnegative(),
});
export type BlackjackSeatSnapshot = z.infer<typeof blackjackSeatSnapshotSchema>;

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
  seats: z.array(blackjackSeatSnapshotSchema).length(7),
  mySeat: z.number().int().min(1).max(7).nullable(),
  spectatorCount: z.number().int().nonnegative(),
  behindBets: z.array(blackjackBehindBetSnapshotSchema),
  myBet: z.number().int().nonnegative(),
  myHand: blackjackPlayerHandSchema.nullable(),
  myHands: z.array(blackjackPlayerHandSchema).max(4),
  activeHandId: z.string().uuid().nullable(),
  insuranceOffered: z.boolean(),
  myInsurance: blackjackInsuranceSnapshotSchema.nullable(),
  walletBalance: z.number().int().nonnegative(),
  shoeRemaining: z.number().int().nonnegative(),
  lightningFeePercent: z.union([z.literal(0), z.literal(100)]).optional(),
  activeLightningMultiplier: z.number().int().min(1).max(25).nullable().optional(),
  nextLightningMultiplier: z.number().int().min(2).max(25).nullable().optional(),
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
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  handId: z.string().uuid(),
  action: blackjackActionSchema,
});
export type BlackjackActionCommand = z.infer<typeof blackjackActionCommandSchema>;

export const blackjackInsuranceCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
});
export type BlackjackInsuranceCommand = z.infer<typeof blackjackInsuranceCommandSchema>;

export const blackjackSeatCommandSchema = z.object({
  roomId: z.string().uuid(),
  seatNumber: z.number().int().min(1).max(7),
});
export type BlackjackSeatCommand = z.infer<typeof blackjackSeatCommandSchema>;

export const blackjackBehindBetCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  targetSeat: z.number().int().min(1).max(7),
  amount: z.number().int().positive(),
});
export type BlackjackBehindBetCommand = z.infer<typeof blackjackBehindBetCommandSchema>;

/** Withdraws the caller's own not-yet-dealt main bet during BETTING. Same one-shot cancel as Baccarat/Dragon Tiger's bet.cancel. */
export const blackjackCancelBetCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
});
export type BlackjackCancelBetCommand = z.infer<typeof blackjackCancelBetCommandSchema>;

/** Withdraws the caller's own not-yet-dealt behind bet on targetSeat during BETTING. */
export const blackjackCancelBehindCommandSchema = z.object({
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  targetSeat: z.number().int().min(1).max(7),
});
export type BlackjackCancelBehindCommand = z.infer<typeof blackjackCancelBehindCommandSchema>;

// ---------------------------------------------------------------------------
// Hold'em: 6-max No-Limit Texas Hold'em. Unlike the automatic tables above,
// the house is never the counterparty — the pot is escrowed in the room's
// wallet account across a hand and settle() splits it back to the winner(s)
// (minus rake) instead of crediting the house on a loss.
// ---------------------------------------------------------------------------

export const holdemStreetSchema = z.enum(["preflop", "flop", "turn", "river", "showdown"]);
export type HoldemStreet = z.infer<typeof holdemStreetSchema>;

export const holdemActionSchema = z.enum(["fold", "check", "call", "bet", "raise", "allin"]);
export type HoldemAction = z.infer<typeof holdemActionSchema>;

export const pokerHandCategorySchema = z.enum([
  "high_card",
  "pair",
  "two_pair",
  "three_of_a_kind",
  "straight",
  "flush",
  "full_house",
  "four_of_a_kind",
  "straight_flush",
]);
export type PokerHandCategoryName = z.infer<typeof pokerHandCategorySchema>;

export const holdemPotSchema = z.object({
  amount: z.number().int().nonnegative(),
  eligibleSeats: z.array(z.number().int().min(1).max(6)),
});
export type HoldemPotSnapshot = z.infer<typeof holdemPotSchema>;

export const holdemSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  streetContributed: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  allIn: z.boolean(),
  sittingOut: z.boolean(),
  isButton: z.boolean(),
  isSmallBlind: z.boolean(),
  isBigBlind: z.boolean(),
  isTurn: z.boolean(),
  holeCards: z.array(cardSchema).length(2).nullable(),
  /** True for seats that were dealt into the current hand. `holeCards` alone can't tell a
   *  viewer this: opponades' cards are null while hidden, which looks identical to a seat
   *  that sat down mid-hand and was never dealt — and the table has to draw card backs for
   *  one and an empty slot for the other. */
  dealtIn: z.boolean(),
  handCategory: pokerHandCategorySchema.nullable(),
  /** Sticky across hands once set (cleared only by un-readying or standing up) — only shown
   *  to the player pre-hand (room.phase WAITING); irrelevant once a hand is underway. */
  ready: z.boolean(),
});
export type HoldemSeatSnapshot = z.infer<typeof holdemSeatSchema>;

export const holdemWinnerSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  username: z.string(),
  amount: z.number().int().nonnegative(),
  handCategory: pokerHandCategorySchema.nullable(),
});
export type HoldemWinnerSnapshot = z.infer<typeof holdemWinnerSchema>;

export const holdemRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  phaseEndsAt: z.string().datetime().nullable(),
  street: holdemStreetSchema.nullable(),
  board: z.array(cardSchema),
  pots: z.array(holdemPotSchema),
  seats: z.array(holdemSeatSchema),
  mySeatNumber: z.number().int().min(1).max(6).nullable(),
  toCall: z.number().int().nonnegative(),
  minRaiseTo: z.number().int().nonnegative(),
  actingSeat: z.number().int().min(1).max(6).nullable(),
  lastWinners: z.array(holdemWinnerSchema),
  walletBalance: z.number().int().nonnegative(),
});
export type HoldemRoomSnapshot = z.infer<typeof holdemRoomSnapshotSchema>;

export const holdemSeatCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  seatNumber: z.number().int().min(1).max(6),
});
export type HoldemSeatCommand = z.infer<typeof holdemSeatCommandSchema>;

export const holdemReadyCommandSchema = z.object({
  roomId: z.string().uuid(),
  ready: z.boolean(),
});
export type HoldemReadyCommand = z.infer<typeof holdemReadyCommandSchema>;

export const holdemActionCommandSchema = z.object({
  requestId: z.string().uuid(),
  roomId: z.string().uuid(),
  roundId: z.string().uuid(),
  action: holdemActionSchema,
  /** "Raise to" target total street contribution. Required for bet/raise, ignored otherwise. */
  amount: z.number().int().nonnegative().optional(),
});
export type HoldemActionCommand = z.infer<typeof holdemActionCommandSchema>;

// ---------------------------------------------------------------------------
// Sutda: 2–6 player PvP.  The server owns both the hidden hwatu deck and every
// betting decision; the client only receives its own cards until showdown.
// ---------------------------------------------------------------------------
export const hwatuKindSchema = z.enum(["hikari", "tanzaku", "tane", "kasu"]);
export type HwatuKind = z.infer<typeof hwatuKindSchema>;
export const hwatuCardSchema = z.object({
  id: z.string(),
  month: z.number().int().min(1).max(10),
  kind: hwatuKindSchema,
});
export type HwatuCard = z.infer<typeof hwatuCardSchema>;

export const sutdaStreetSchema = z.enum(["first", "final", "showdown"]);
export type SutdaStreet = z.infer<typeof sutdaStreetSchema>;
export const sutdaActionSchema = z.enum(["die", "check", "call", "half"]);
export type SutdaAction = z.infer<typeof sutdaActionSchema>;
export const sutdaPotSchema = z.object({ amount: z.number().int().nonnegative() });
export type SutdaPotSnapshot = z.infer<typeof sutdaPotSchema>;
export const sutdaSeatSchema = z.object({
  seatNumber: z.number().int().min(1).max(6),
  userId: z.string().uuid().nullable(),
  username: z.string().nullable(),
  stack: z.number().int().nonnegative(),
  streetContributed: z.number().int().nonnegative(),
  totalContributed: z.number().int().nonnegative(),
  folded: z.boolean(),
  sittingOut: z.boolean(),
  isDealer: z.boolean(),
  isTurn: z.boolean(),
  cards: z.array(hwatuCardSchema).min(1).max(2).nullable(),
  handLabel: z.string().nullable(),
  ready: z.boolean(),
});
export type SutdaSeatSnapshot = z.infer<typeof sutdaSeatSchema>;
export const sutdaWinnerSchema = z.object({ seatNumber: z.number().int().min(1).max(6), username: z.string(), amount: z.number().int().nonnegative(), handLabel: z.string() });
export type SutdaWinnerSnapshot = z.infer<typeof sutdaWinnerSchema>;
export const sutdaRoomSnapshotSchema = z.object({
  room: gameRoomSchema,
  roundId: z.string().uuid().nullable(),
  sequence: z.number().int().nonnegative(),
  phaseEndsAt: z.string().datetime().nullable(),
  street: sutdaStreetSchema.nullable(),
  pot: sutdaPotSchema,
  seats: z.array(sutdaSeatSchema).length(6),
  mySeatNumber: z.number().int().min(1).max(6).nullable(),
  toCall: z.number().int().nonnegative(),
  actingSeat: z.number().int().min(1).max(6).nullable(),
  lastWinners: z.array(sutdaWinnerSchema),
  walletBalance: z.number().int().nonnegative(),
});
export type SutdaRoomSnapshot = z.infer<typeof sutdaRoomSnapshotSchema>;
export const sutdaSeatCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), seatNumber: z.number().int().min(1).max(6) });
export type SutdaSeatCommand = z.infer<typeof sutdaSeatCommandSchema>;
export const sutdaReadyCommandSchema = z.object({ roomId: z.string().uuid(), ready: z.boolean() });
export type SutdaReadyCommand = z.infer<typeof sutdaReadyCommandSchema>;
export const sutdaActionCommandSchema = z.object({ requestId: z.string().uuid(), roomId: z.string().uuid(), roundId: z.string().uuid(), action: sutdaActionSchema });
export type SutdaActionCommand = z.infer<typeof sutdaActionCommandSchema>;

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
  wageringRemaining: z.number().int().nonnegative(),
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

export const wageringProgressSchema = z.object({
  required: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  canWithdraw: z.boolean(),
});
export type WageringProgress = z.infer<typeof wageringProgressSchema>;

export const profileResponseSchema = z.object({
  user: authUserSchema,
  walletBalance: z.number().int().nonnegative(),
  stats: profileStatsSchema,
  wagering: wageringProgressSchema,
  cashRequests: z.array(cashRequestSchema),
  transactions: z.array(walletTransactionItemSchema),
  recipients: z.array(z.object({ nickname: z.string() })),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** One settled bet/hand, normalized across baccarat/dragon tiger (wagers), blackjack
 * (blackjack_hands), and hold'em (holdem_contributions) for the game history page. */
export const gameHistoryItemSchema = z.object({
  id: z.string(),
  game: gameTypeSchema,
  roomName: z.string(),
  choiceLabel: z.string(),
  amount: z.number().int().nonnegative(),
  outcome: z.enum(["win", "lose", "push", "blackjack", "surrender"]).nullable(),
  net: z.number().int(),
  createdAt: z.string(),
});
export type GameHistoryItem = z.infer<typeof gameHistoryItemSchema>;

export const gameHistoryStatsSchema = z.object({
  totalWagered: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  pushes: z.number().int().nonnegative(),
  net: z.number().int(),
});
export type GameHistoryStats = z.infer<typeof gameHistoryStatsSchema>;

export const gameHistoryResponseSchema = z.object({
  items: z.array(gameHistoryItemSchema),
  overall: gameHistoryStatsSchema,
  byGame: z.array(gameHistoryStatsSchema.extend({ game: gameTypeSchema })),
});
export type GameHistoryResponse = z.infer<typeof gameHistoryResponseSchema>;

export const cashRequestCreateSchema = z.object({
  type: cashRequestTypeSchema,
  amount: z.number().int().positive(),
});
export type CashRequestCreate = z.infer<typeof cashRequestCreateSchema>;

export const transferCreateSchema = z.object({
  requestId: z.string().uuid(),
  recipientNickname: z.string().min(2).max(20),
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
  game: gameTypeSchema,
  maskedUsername: z.string(),
  choiceLabel: z.string(),
  amount: z.number().int().positive(),
  createdAt: z.string(),
});
export type WinnerFeedEntry = z.infer<typeof winnerFeedEntrySchema>;

export const siteAnnouncementSchema = z.object({
  id: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
export type SiteAnnouncement = z.infer<typeof siteAnnouncementSchema>;

export const adminBroadcastSchema = z.object({
  scope: z.enum(["all", "room"]),
  roomId: z.string().uuid().optional(),
  message: z.string().min(1).max(200),
});
export type AdminBroadcast = z.infer<typeof adminBroadcastSchema>;

export type SocketAck<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

export interface ServerToClientEvents {
  "room.snapshot": (snapshot: RoomSnapshot) => void;
  "room.presence": (payload: { roomId: string; playerCount: number }) => void;
  "room.chat.message": (message: ChatMessage) => void;
  "room.winners": (payload: { entries: WinnerFeedEntry[] }) => void;
  "site.announcement": (payload: SiteAnnouncement) => void;
  "support.message": (message: ChatMessage) => void;
  "cash.request.created": (payload: { id: string; type: CashRequestType; amount: number; username: string; createdAt: string }) => void;
  "wallet.updated": (payload: { balance: number }) => void;
  "notification": (payload: { type: "success" | "error" | "info"; message: string }) => void;
  "blackjack.snapshot": (snapshot: BlackjackRoomSnapshot) => void;
  "dragonTiger.snapshot": (snapshot: DragonTigerRoomSnapshot) => void;
  "holdem.snapshot": (snapshot: HoldemRoomSnapshot) => void;
  "sutda.snapshot": (snapshot: SutdaRoomSnapshot) => void;
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
  "blackjack.seat.claim": (payload: BlackjackSeatCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.seat.leave": (payload: { roomId: string }, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.betBehind": (payload: BlackjackBehindBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.cancelBet": (payload: BlackjackCancelBetCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.cancelBehind": (payload: BlackjackCancelBehindCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.insurance": (payload: BlackjackInsuranceCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "blackjack.action": (payload: BlackjackActionCommand, ack: (response: SocketAck<BlackjackRoomSnapshot>) => void) => void;
  "dragonTiger.join": (payload: { roomId: string }, ack: (response: SocketAck<DragonTigerRoomSnapshot>) => void) => void;
  "dragonTiger.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "dragonTiger.bet": (payload: DragonTigerBetCommand, ack: (response: SocketAck<DragonTigerRoomSnapshot>) => void) => void;
  "dragonTiger.cancel": (payload: DragonTigerCancelCommand, ack: (response: SocketAck<DragonTigerRoomSnapshot>) => void) => void;
  "holdem.join": (payload: { roomId: string }, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "holdem.sit": (payload: HoldemSeatCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.ready": (payload: HoldemReadyCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.standUp": (payload: { roomId: string }, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "holdem.act": (payload: HoldemActionCommand, ack: (response: SocketAck<HoldemRoomSnapshot>) => void) => void;
  "sutda.join": (payload: { roomId: string }, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.leave": (payload: { roomId: string }, ack: (response: SocketAck) => void) => void;
  "sutda.sit": (payload: SutdaSeatCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.standUp": (payload: { roomId: string }, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.ready": (payload: SutdaReadyCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
  "sutda.act": (payload: SutdaActionCommand, ack: (response: SocketAck<SutdaRoomSnapshot>) => void) => void;
}

export const COIN_SCALE = 100;
