import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import {
  blackjackActionCommandSchema,
  blackjackBetCommandSchema,
  cancelBetCommandSchema,
  cashRequestCreateSchema,
  COIN_SCALE,
  placeBetCommandSchema,
  transferCreateSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@golden/contracts";
import { authRouter } from "./auth/routes.js";
import { requireAdmin, requireAuth, verifyToken, type AuthRequest, type AuthUser } from "./auth/auth.js";
import { config } from "./config.js";
import { pool } from "./database/pool.js";
import { RoomManager } from "./games/rooms/room-manager.js";
import { BlackjackRoomManager } from "./games/rooms/blackjack-room-manager.js";
import { walletService } from "./wallet/wallet-service.js";
import { createAdminSupportMessage, createRoomMessage, createSupportMessage, listAdminSupportConversations, listConversationMessages, listRoomMessages, listSupportMessages } from "./chat/chat-service.js";

const app = express();
app.use(cors({ origin: config.webOrigins, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use("/api/v1/auth", authRouter);

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: AuthUser }>(httpServer, {
  cors: { origin: config.webOrigins },
  transports: ["websocket", "polling"],
});
const rooms = new RoomManager(io);
const blackjackRooms = new BlackjackRoomManager(io);

app.get("/api/v1/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});

app.get("/api/v1/lobby", requireAuth, async (req, res) => {
  const user = (req as AuthRequest).user;
  res.json({ rooms: [...rooms.listRooms(), ...blackjackRooms.listRooms()], walletBalance: await walletService.getUserBalance(user.id) });
});

app.post("/api/v1/admin/rooms/:roomId/pause", requireAuth, requireAdmin, (req, res) => {
  const roomId = String(req.params.roomId ?? "");
  const ok = rooms.setPaused(roomId, true) || blackjackRooms.setPaused(roomId, true);
  if (!ok) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
  res.json({ status: "paused" });
});

app.post("/api/v1/admin/rooms/:roomId/resume", requireAuth, requireAdmin, (req, res) => {
  const roomId = String(req.params.roomId ?? "");
  const ok = rooms.setPaused(roomId, false) || blackjackRooms.setPaused(roomId, false);
  if (!ok) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
  res.json({ status: "resumed" });
});

app.get("/api/v1/admin/overview", requireAuth, requireAdmin, async (req, res) => {
  const admin = (req as AuthRequest).user;
  const [roomRows, userRows, houseRows, roundRows, cashRows, supportRows] = await Promise.all([
    pool.query<{ id: string; game_type: "baccarat" | "blackjack"; code: string; name: string; min_bet: number; max_bet: number; enabled: boolean }>(
      "SELECT id,game_type,code,name,min_bet,max_bet,enabled FROM game_rooms ORDER BY min_bet,game_type",
    ),
    pool.query<{
      id: string;
      username: string;
      role: "user" | "admin";
      approved: boolean;
      created_at: string;
      balance_minor: string;
      total_bets: string;
      total_wagered: string;
      wins: string;
      losses: string;
    }>(
      `SELECT u.id,u.username,u.role,u.approved,u.created_at,
              COALESCE(wa.balance_minor,0) AS balance_minor,
              COALESCE(stats.total_bets,0) AS total_bets,
              COALESCE(stats.total_wagered,0) AS total_wagered,
              COALESCE(stats.wins,0) AS wins,
              COALESCE(stats.losses,0) AS losses
       FROM users u
       LEFT JOIN wallet_accounts wa ON wa.kind='user' AND wa.user_id=u.id
       LEFT JOIN (
         SELECT user_id,COUNT(*) AS total_bets,SUM(amount_minor) AS total_wagered,
                COUNT(*) FILTER (WHERE outcome='win') AS wins,
                COUNT(*) FILTER (WHERE outcome='lose') AS losses
         FROM wagers GROUP BY user_id
       ) stats ON stats.user_id=u.id
       ORDER BY u.created_at DESC LIMIT 200`,
    ),
    pool.query<{ balance_minor: string }>("SELECT COALESCE((SELECT balance_minor FROM wallet_accounts WHERE kind='house'),0) AS balance_minor"),
    pool.query<{ total_rounds: string; player_rounds: string; banker_rounds: string; tie_rounds: string }>(
      `SELECT COUNT(*) AS total_rounds,
              COUNT(*) FILTER (WHERE result='player') AS player_rounds,
              COUNT(*) FILTER (WHERE result='banker') AS banker_rounds,
              COUNT(*) FILTER (WHERE result='tie') AS tie_rounds
       FROM game_rounds WHERE result IS NOT NULL`,
    ),
    pool.query<{ count: string; amount_minor: string }>(
      `SELECT COUNT(*) FILTER (WHERE status='pending') AS count,
              COALESCE(SUM(amount_minor) FILTER (WHERE status='pending'),0) AS amount_minor
       FROM cash_requests`,
    ),
    pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM support_conversations WHERE status='open'"),
  ]);

  const liveRooms = new Map([...rooms.listRooms(), ...blackjackRooms.listRooms()].map((room) => [room.id, room]));
  const adminRooms = roomRows.rows.map((room) => {
    const live = liveRooms.get(room.id);
    return {
      id: room.id,
      gameType: room.game_type,
      code: room.code,
      name: room.name,
      minBet: room.min_bet,
      maxBet: room.max_bet,
      playerCount: live?.playerCount ?? 0,
      phase: live?.phase ?? "WAITING",
      enabled: room.enabled,
      paused: live?.paused ?? false,
    };
  });
  const houseMetrics = await pool.query<{ total_wagered: string; house_profit: string; settled_wagers: string; active_bettors: string }>(
    `SELECT COALESCE(SUM(amount_minor),0) AS total_wagered,
            COALESCE(SUM(CASE WHEN outcome='lose' THEN amount_minor WHEN outcome='win' THEN amount_minor-COALESCE(payout_minor,0) ELSE 0 END),0) AS house_profit,
            COUNT(*) FILTER (WHERE status='settled') AS settled_wagers,
            COUNT(DISTINCT user_id) FILTER (WHERE status='settled') AS active_bettors
     FROM wagers`,
  );
  const house = houseMetrics.rows[0]!;
  res.json({
    walletBalance: await walletService.getUserBalance(admin.id),
    rooms: adminRooms,
    users: userRows.rows.map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      approved: user.approved,
      createdAt: user.created_at,
      balance: coins(user.balance_minor),
      totalBets: Number(user.total_bets),
      totalWagered: coins(user.total_wagered),
      wins: Number(user.wins),
      losses: Number(user.losses),
    })),
    house: {
      balance: coins(houseRows.rows[0]?.balance_minor ?? 0),
      totalWagered: coins(house.total_wagered),
      houseProfit: coins(house.house_profit),
      settledWagers: Number(house.settled_wagers),
      activeBettors: Number(house.active_bettors),
      totalRounds: Number(roundRows.rows[0]?.total_rounds ?? 0),
      playerRounds: Number(roundRows.rows[0]?.player_rounds ?? 0),
      bankerRounds: Number(roundRows.rows[0]?.banker_rounds ?? 0),
      tieRounds: Number(roundRows.rows[0]?.tie_rounds ?? 0),
    },
    pendingCashRequests: { count: Number(cashRows.rows[0]?.count ?? 0), amount: coins(cashRows.rows[0]?.amount_minor ?? 0) },
    openSupportConversations: Number(supportRows.rows[0]?.count ?? 0),
  });
});

app.post("/api/v1/admin/users/:userId/approval", requireAuth, requireAdmin, async (req, res) => {
  const admin = (req as AuthRequest).user;
  const userId = String(req.params.userId ?? "");
  const approved = req.body?.approved;
  if (typeof approved !== "boolean") return void res.status(400).json({ message: "사용자 상태를 확인해주세요." });
  if (!z.string().uuid().safeParse(userId).success) return void res.status(400).json({ message: "사용자를 찾을 수 없습니다." });
  if (userId === admin.id) return void res.status(400).json({ message: "현재 관리자 계정은 정지할 수 없습니다." });
  const result = await pool.query<{ id: string; role: "user" | "admin" }>(
    "UPDATE users SET approved=$2,updated_at=now() WHERE id=$1 AND role='user' RETURNING id,role",
    [userId, approved],
  );
  if (!result.rows[0]) return void res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
  await pool.query(
    "INSERT INTO audit_logs (actor_user_id,action,target_type,target_id,details) VALUES ($1,$2,'user',$3,$4)",
    [admin.id, approved ? "USER_APPROVED" : "USER_SUSPENDED", userId, JSON.stringify({ approved })],
  );
  res.json({ status: approved ? "approved" : "suspended" });
});

app.get("/api/v1/profile", requireAuth, async (req, res) => {
  const user = (req as AuthRequest).user;
  const [stats, transactions, cashRequests, recipients] = await Promise.all([
    pool.query<{ total_wagered: string; settled_wagered: string; wins: string; losses: string; pushes: string; net_result: string }>(
      `SELECT COALESCE(SUM(amount_minor),0) AS total_wagered,
              COALESCE(SUM(amount_minor) FILTER (WHERE status='settled'),0) AS settled_wagered,
              COUNT(*) FILTER (WHERE outcome='win') AS wins,
              COUNT(*) FILTER (WHERE outcome='lose') AS losses,
              COUNT(*) FILTER (WHERE outcome='push') AS pushes,
              COALESCE(SUM(CASE WHEN status='settled' THEN COALESCE(payout_minor,0)-amount_minor ELSE 0 END),0) AS net_result
       FROM wagers WHERE user_id=$1`,
      [user.id],
    ),
    walletTransactionsForUser(user.id, 30),
    pool.query<{ id: string; request_type: "deposit" | "withdraw"; amount_minor: string; status: "pending" | "approved" | "rejected" | "cancelled"; created_at: string }>(
      "SELECT id,request_type,amount_minor,status,created_at FROM cash_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
      [user.id],
    ),
    pool.query<{ username: string }>("SELECT username FROM users WHERE id<>$1 AND approved=true AND role='user' ORDER BY username LIMIT 100", [user.id]),
  ]);
  const row = stats.rows[0]!;
  res.json({
    user: { id: user.id, username: user.username, role: user.role },
    walletBalance: await walletService.getUserBalance(user.id),
    stats: {
      totalWagered: coins(row.total_wagered),
      settledWagered: coins(row.settled_wagered),
      wins: Number(row.wins),
      losses: Number(row.losses),
      pushes: Number(row.pushes),
      netResult: coins(row.net_result),
    },
    cashRequests: cashRequests.rows.map((request) => ({ id: request.id, type: request.request_type, amount: coins(request.amount_minor), status: request.status, createdAt: request.created_at })),
    transactions: transactions.rows,
    recipients: recipients.rows,
  });
});

app.post("/api/v1/wallet/cash-requests", requireAuth, async (req, res) => {
  const parsed = cashRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "신청 금액을 확인해주세요." });
  const user = (req as AuthRequest).user;
  const amountMinor = parsed.data.amount * COIN_SCALE;
  const result = await pool.query<{ id: string; request_type: "deposit" | "withdraw"; amount_minor: string; status: "pending"; created_at: string }>(
    `INSERT INTO cash_requests (user_id,request_type,amount_minor)
     VALUES ($1,$2,$3) RETURNING id,request_type,amount_minor,status,created_at`,
    [user.id, parsed.data.type, amountMinor],
  );
  const request = result.rows[0]!;
  res.status(201).json({ id: request.id, type: request.request_type, amount: coins(request.amount_minor), status: request.status, createdAt: request.created_at });
});

app.post("/api/v1/wallet/transfers", requireAuth, async (req, res) => {
  const parsed = transferCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "송금 정보를 확인해주세요." });
  const user = (req as AuthRequest).user;
  try {
    const result = await walletService.transfer(user.id, parsed.data.recipientUsername, parsed.data.amount * COIN_SCALE, parsed.data.requestId);
    res.status(result.duplicate ? 200 : 201).json({ status: "ok", duplicate: result.duplicate, walletBalance: await walletService.getUserBalance(user.id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "TRANSFER_FAILED";
    if (code === "RECIPIENT_NOT_FOUND") return res.status(404).json({ message: "송금할 사용자를 찾을 수 없습니다." });
    if (code === "RECIPIENT_SELF") return res.status(400).json({ message: "본인에게는 송금할 수 없습니다." });
    if (code === "INSUFFICIENT_BALANCE") return res.status(400).json({ message: "잔액이 부족합니다." });
    if (code === "IDEMPOTENCY_CONFLICT") return res.status(409).json({ message: "중복 요청 정보가 일치하지 않습니다." });
    throw error;
  }
});

app.get("/api/v1/admin/wallet/cash-requests", requireAuth, requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT cr.id,cr.request_type,cr.amount_minor,cr.status,cr.created_at,u.username
     FROM cash_requests cr JOIN users u ON u.id=cr.user_id ORDER BY cr.created_at DESC LIMIT 100`,
  );
  res.json({ items: result.rows.map((row) => ({ ...row, amount: coins(row.amount_minor) })) });
});

app.post("/api/v1/admin/wallet/cash-requests/:requestId/decision", requireAuth, requireAdmin, async (req, res) => {
  const decision = req.body?.decision;
  if (decision !== "approved" && decision !== "rejected") return res.status(400).json({ message: "처리 결과를 확인해주세요." });
  try {
    await walletService.decideCashRequest(String(req.params.requestId ?? ""), (req as AuthRequest).user.id, decision);
    res.json({ status: decision });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CASH_REQUEST_FAILED";
    if (code === "CASH_REQUEST_NOT_FOUND") return res.status(404).json({ message: "신청을 찾을 수 없습니다." });
    if (code === "INSUFFICIENT_BALANCE") return res.status(400).json({ message: "잔액이 부족합니다." });
    throw error;
  }
});

app.get("/api/v1/chat/rooms/:roomId/messages", requireAuth, async (req, res) => {
  const roomId = String(req.params.roomId ?? "");
  const room = await pool.query("SELECT 1 FROM game_rooms WHERE id=$1 AND enabled=true", [roomId]);
  if (!room.rows[0]) return void res.status(404).json({ message: "방을 찾을 수 없습니다." });
  res.json({ items: await listRoomMessages(roomId) });
});

app.get("/api/v1/support/messages", requireAuth, async (req, res) => {
  res.json({ items: await listSupportMessages((req as AuthRequest).user.id) });
});

app.get("/api/v1/admin/support/conversations", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ items: await listAdminSupportConversations() });
});

app.get("/api/v1/admin/support/conversations/:conversationId/messages", requireAuth, requireAdmin, async (req, res) => {
  res.json({ items: await listConversationMessages(String(req.params.conversationId ?? "")) });
});

app.post("/api/v1/admin/support/conversations/:conversationId/messages", requireAuth, requireAdmin, async (req, res) => {
  try {
    const message = await createAdminSupportMessage((req as AuthRequest).user.id, String(req.params.conversationId ?? ""), String(req.body?.message ?? ""));
    io.to(`support:user:${message.userId}`).emit("support.message", message);
    io.to("support:admins").emit("support.message", message);
    res.status(201).json(message);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SUPPORT_FAILED";
    if (code === "CHAT_EMPTY" || code === "CHAT_TOO_LONG") return void res.status(400).json({ message: "메시지는 1~500자로 입력해주세요." });
    if (code === "CONVERSATION_NOT_FOUND") return void res.status(404).json({ message: "문의 대화를 찾을 수 없습니다." });
    throw error;
  }
});

app.get("/api/v1/wallet/transactions", requireAuth, async (req, res) => {
  const user = (req as AuthRequest).user;
  res.json({ items: (await walletTransactionsForUser(user.id, 50)).rows });
});

async function walletTransactionsForUser(userId: string, limit: number) {
  const result = await pool.query<{ id: string; transaction_type: string; reference_type: string | null; created_at: string; amount_minor: number }>(
    `SELECT lt.id,lt.transaction_type,lt.reference_type,lt.created_at,le.amount_minor
     FROM ledger_entries le
     JOIN wallet_accounts wa ON wa.id=le.account_id
     JOIN ledger_transactions lt ON lt.id=le.transaction_id
     WHERE wa.user_id=$1 ORDER BY le.id DESC LIMIT $2`,
    [userId, limit],
  );
  return { rows: result.rows.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) })) };
}

function coins(minor: string | number): number {
  return Math.floor(Number(minor) / COIN_SCALE);
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") throw new Error("Missing token");
    socket.data.user = verifyToken(token);
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});

io.on("connection", (socket) => {
  let commandCount = 0;
  let commandWindowStartedAt = Date.now();
  const authorizeCommand = async (): Promise<void> => {
    const now = Date.now();
    if (now - commandWindowStartedAt >= 1_000) {
      commandWindowStartedAt = now;
      commandCount = 0;
    }
    commandCount += 1;
    if (commandCount > 20) throw new Error("RATE_LIMITED");
    if (!socket.data.user.exp || socket.data.user.exp * 1_000 <= now) throw new Error("UNAUTHORIZED");
    const status = await pool.query<{ approved: boolean }>("SELECT approved FROM users WHERE id=$1", [socket.data.user.id]);
    if (!status.rows[0]?.approved) throw new Error("UNAUTHORIZED");
  };

  void socket.join(socket.data.user.role === "admin" ? "support:admins" : `support:user:${socket.data.user.id}`);

  socket.on("room.join", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (!payload || typeof payload.roomId !== "string") throw new Error("ROOM_NOT_FOUND");
      ack({ ok: true, data: await rooms.join(socket, payload.roomId) });
    } catch (error) {
      ack({ ok: false, code: "ROOM_JOIN_FAILED", error: messageFor(error) });
    }
  });
  socket.on("room.leave", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (!payload || typeof payload.roomId !== "string") throw new Error("ROOM_NOT_FOUND");
      await rooms.leave(socket, payload.roomId);
      ack({ ok: true, data: undefined });
    } catch (error) {
      ack({ ok: false, code: "ROOM_LEAVE_FAILED", error: messageFor(error) });
    }
  });
  socket.on("bet.place", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      const parsed = placeBetCommandSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, code: "INVALID_BET", error: "베팅 요청 형식이 올바르지 않습니다." });
      const snapshot = await rooms.placeBet(socket.data.user.id, parsed.data);
      ack({ ok: true, data: snapshot });
    } catch (error) {
      const code = error instanceof Error ? error.message : "BET_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("bet.cancel", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      const parsed = cancelBetCommandSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, code: "INVALID_BET", error: "취소 요청 형식이 올바르지 않습니다." });
      const snapshot = await rooms.cancelBet(socket.data.user.id, parsed.data);
      ack({ ok: true, data: snapshot });
    } catch (error) {
      const code = error instanceof Error ? error.message : "BET_CANCEL_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("room.chat.send", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (!payload || typeof payload.roomId !== "string" || typeof payload.message !== "string") throw new Error("CHAT_INVALID");
      if (!rooms.isParticipant(socket.data.user.id, payload.roomId) && !blackjackRooms.isParticipant(socket.data.user.id, payload.roomId)) throw new Error("ROOM_JOIN_REQUIRED");
      const message = await createRoomMessage(socket.data.user.id, payload.roomId, payload.message);
      io.to(`room:${payload.roomId}`).emit("room.chat.message", message);
      ack({ ok: true, data: message });
    } catch (error) {
      const code = error instanceof Error ? error.message : "CHAT_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("support.send", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (!payload || typeof payload.message !== "string") throw new Error("CHAT_INVALID");
      const message = await createSupportMessage(socket.data.user.id, payload.message);
      socket.emit("support.message", message);
      io.to("support:admins").emit("support.message", message);
      ack({ ok: true, data: message });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SUPPORT_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("admin.support.send", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (socket.data.user.role !== "admin") throw new Error("ADMIN_REQUIRED");
      if (!payload || typeof payload.conversationId !== "string" || typeof payload.message !== "string") throw new Error("CHAT_INVALID");
      const message = await createAdminSupportMessage(socket.data.user.id, payload.conversationId, payload.message);
      io.to(`support:user:${message.userId}`).emit("support.message", message);
      io.to("support:admins").emit("support.message", message);
      ack({ ok: true, data: message });
    } catch (error) {
      const code = error instanceof Error ? error.message : "SUPPORT_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("blackjack.join", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (!payload || typeof payload.roomId !== "string") throw new Error("ROOM_NOT_FOUND");
      ack({ ok: true, data: await blackjackRooms.join(socket, payload.roomId) });
    } catch (error) {
      ack({ ok: false, code: "ROOM_JOIN_FAILED", error: messageFor(error) });
    }
  });
  socket.on("blackjack.leave", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      if (!payload || typeof payload.roomId !== "string") throw new Error("ROOM_NOT_FOUND");
      await blackjackRooms.leave(socket, payload.roomId);
      ack({ ok: true, data: undefined });
    } catch (error) {
      ack({ ok: false, code: "ROOM_LEAVE_FAILED", error: messageFor(error) });
    }
  });
  socket.on("blackjack.bet", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      const parsed = blackjackBetCommandSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, code: "INVALID_BET", error: "베팅 요청 형식이 올바르지 않습니다." });
      const snapshot = await blackjackRooms.placeBet(socket.data.user.id, parsed.data);
      ack({ ok: true, data: snapshot });
    } catch (error) {
      const code = error instanceof Error ? error.message : "BET_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("blackjack.action", async (payload, ack) => {
    if (typeof ack !== "function") return;
    try {
      await authorizeCommand();
      const parsed = blackjackActionCommandSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, code: "INVALID_ACTION", error: "요청 형식이 올바르지 않습니다." });
      const snapshot = await blackjackRooms.act(socket.data.user.id, parsed.data);
      ack({ ok: true, data: snapshot });
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACTION_FAILED";
      ack({ ok: false, code, error: messageFor(error) });
    }
  });
  socket.on("disconnect", () => {
    void rooms.disconnect(socket);
    void blackjackRooms.disconnect(socket);
  });
});

function messageFor(error: unknown): string {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "INSUFFICIENT_BALANCE") return "잔액이 부족합니다.";
  if (code === "BET_LIMIT") return "이 방의 베팅 한도를 확인해주세요.";
  if (code === "BETTING_CLOSED") return "베팅 시간이 종료되었습니다.";
  if (code === "ROOM_NOT_FOUND") return "입장할 수 없는 방입니다.";
  if (code === "ROOM_JOIN_REQUIRED") return "테이블에 먼저 입장해주세요.";
  if (code === "BET_NOT_FOUND") return "취소할 베팅이 없습니다.";
  if (code === "BET_ALREADY_PLACED") return "이번 라운드에는 이미 베팅했습니다.";
  if (code === "NOT_YOUR_TURN") return "지금은 액션을 할 수 있는 시간이 아닙니다.";
  if (code === "NO_ACTIVE_HAND") return "진행 중인 핸드가 없습니다.";
  if (code === "DOUBLE_NOT_ALLOWED") return "카드가 2장일 때만 더블다운할 수 있습니다.";
  if (code === "IDEMPOTENCY_CONFLICT") return "중복 요청 정보가 일치하지 않습니다.";
  if (code === "RATE_LIMITED") return "요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.";
  if (code === "UNAUTHORIZED") return "로그인이 만료되었거나 이용 승인이 취소되었습니다.";
  if (code === "CHAT_EMPTY" || code === "CHAT_TOO_LONG" || code === "CHAT_INVALID") return "메시지는 1~500자로 입력해주세요.";
  if (code === "ADMIN_REQUIRED") return "관리자만 이용할 수 있습니다.";
  if (code === "CONVERSATION_NOT_FOUND") return "문의 대화를 찾을 수 없습니다.";
  console.error(error);
  return "요청 처리 중 오류가 발생했습니다.";
}

await rooms.initialize();
await blackjackRooms.initialize();
httpServer.listen(config.port, "127.0.0.1", () => {
  console.log(`Golden Casino API listening on http://127.0.0.1:${config.port}`);
});

async function shutdown(): Promise<void> {
  io.close();
  httpServer.close();
  await pool.end();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
