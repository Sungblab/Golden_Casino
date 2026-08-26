import { adminOverviewSchema, adminCashRequestSchema, cashRequestSchema, chatHistoryResponseSchema, gameHistoryResponseSchema, gameRoomSchema, lobbyResponseSchema, loginResponseSchema, profileResponseSchema, registerResponseSchema, supportConversationListSchema, walletTransactionsResponseSchema, type AdminCashRequest, type AdminOverview, type CashRequest, type ChatHistoryResponse, type GameHistoryResponse, type LobbyResponse, type LoginResponse, type ProfileResponse, type SupportConversationList, type WalletTransactionsResponse } from "@golden/contracts";
import { randomRequestId } from "./lib/requestId";

export const API_URL = import.meta.env.VITE_API_URL ?? "";

async function request(path: string, options: RequestInit = {}, token?: string): Promise<unknown> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/v1/auth/login" && path !== "/api/v1/auth/logout" && path !== "/api/v1/auth/refresh") {
    window.dispatchEvent(new Event("golden:session-expired"));
  }
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "요청에 실패했습니다.");
  return body;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return loginResponseSchema.parse(await request("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }));
}

export async function register(username: string, nickname: string, password: string): Promise<void> {
  registerResponseSchema.parse(await request("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ username, nickname, password }) }));
}

let refreshInFlight: Promise<LoginResponse> | null = null;

/**
 * Rotates the httpOnly refresh cookie and returns a fresh short-lived access token.
 *
 * Concurrent callers share one in-flight request instead of each firing their own: the periodic
 * 20-minute timer, a 401-triggered retry, and the initial mount-time restore can all want a
 * refresh within the same instant, and the refresh token rotates on every use — two overlapping
 * calls from this same tab would race each other for nothing (the server tolerates that race too,
 * see REFRESH_REUSE_GRACE_MS, but avoiding it here is free and avoids depending on that window).
 */
export function refreshAccessToken(): Promise<LoginResponse> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => loginResponseSchema.parse(await request("/api/v1/auth/refresh", { method: "POST" })))()
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function logoutServer(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function pauseRoom(token: string, roomId: string): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}/pause`, { method: "POST" }, token);
}

export async function resumeRoom(token: string, roomId: string): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}/resume`, { method: "POST" }, token);
}

/** Clears a Baccarat/Dragon Tiger table's visible road/scoreboard. Underlying round & wager
 * history is untouched — only which rounds feed the road display resets. */
export async function resetRoomRoad(token: string, roomId: string): Promise<void> {
  await request(`/api/v1/admin/rooms/${roomId}/reset-road`, { method: "POST" }, token);
}

export async function sendAdminBroadcast(token: string, payload: { scope: "all" | "room"; roomId?: string; message: string }): Promise<void> {
  await request("/api/v1/admin/broadcast", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function getAdminOverview(token: string): Promise<AdminOverview> {
  return adminOverviewSchema.parse(await request("/api/v1/admin/overview", {}, token));
}

export async function setAdminUserApproval(token: string, userId: string, approved: boolean): Promise<void> {
  await request(`/api/v1/admin/users/${userId}/approval`, { method: "POST", body: JSON.stringify({ approved }) }, token);
}

export async function setAdminUserRole(token: string, userId: string, role: "user" | "admin"): Promise<void> {
  await request(`/api/v1/admin/users/${userId}/role`, { method: "POST", body: JSON.stringify({ role }) }, token);
}

export async function adminDeleteUser(token: string, userId: string): Promise<void> {
  await request(`/api/v1/admin/users/${userId}`, { method: "DELETE" }, token);
}

export async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  await request("/api/v1/profile/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }, token);
}

export async function adminResetPassword(token: string, userId: string): Promise<{ tempPassword: string }> {
  return await request(`/api/v1/admin/users/${userId}/reset-password`, { method: "POST" }, token) as { tempPassword: string };
}

export async function adminAdjustBalance(token: string, userId: string, amount: number): Promise<{ balance: number }> {
  return await request(
    `/api/v1/admin/users/${userId}/balance`,
    { method: "POST", body: JSON.stringify({ amount, requestId: randomRequestId() }) },
    token,
  ) as { balance: number };
}

export async function getAdminCashRequests(token: string): Promise<AdminCashRequest[]> {
  const body = await request("/api/v1/admin/wallet/cash-requests", {}, token) as { items: unknown[] };
  return body.items.map((item) => adminCashRequestSchema.parse(item));
}

export async function decideAdminCashRequest(token: string, requestId: string, decision: "approved" | "rejected"): Promise<void> {
  await request(`/api/v1/admin/wallet/cash-requests/${requestId}/decision`, { method: "POST", body: JSON.stringify({ decision }) }, token);
}

export async function getLobby(token: string): Promise<LobbyResponse> {
  const body = await request("/api/v1/lobby", {}, token) as { rooms?: unknown[]; walletBalance?: unknown };
  // Validate each room independently and drop the ones that don't parse, instead of failing the
  // whole response the instant one doesn't match — a strict `z.array(gameRoomSchema).parse(...)`
  // rejects the ENTIRE list over a single bad item, which is exactly what happened when the API
  // started serving a game type this client build didn't know about yet (API deployed a beat
  // ahead of the web bundle): the whole lobby went blank and threw the raw Zod error onto the
  // page. One unrecognized room now just doesn't show up instead of taking the page down with it.
  const rooms = (body.rooms ?? []).flatMap((room) => {
    const parsed = gameRoomSchema.safeParse(room);
    if (!parsed.success) {
      console.warn("Skipping a lobby room this client build can't parse", parsed.error.issues);
      return [];
    }
    return [parsed.data];
  });
  return lobbyResponseSchema.parse({ rooms, walletBalance: body.walletBalance });
}

export async function getWalletTransactions(token: string): Promise<WalletTransactionsResponse> {
  return walletTransactionsResponseSchema.parse(await request("/api/v1/wallet/transactions", {}, token));
}

export async function getProfile(token: string): Promise<ProfileResponse> {
  return profileResponseSchema.parse(await request("/api/v1/profile", {}, token));
}

export async function getGameHistory(token: string): Promise<GameHistoryResponse> {
  return gameHistoryResponseSchema.parse(await request("/api/v1/game-history", {}, token));
}

export async function createCashRequest(token: string, type: "deposit" | "withdraw", amount: number): Promise<CashRequest> {
  return cashRequestSchema.parse(await request("/api/v1/wallet/cash-requests", { method: "POST", body: JSON.stringify({ type, amount }) }, token));
}

export async function createTransfer(token: string, recipientNickname: string, amount: number): Promise<{ walletBalance: number; duplicate: boolean }> {
  const body = await request("/api/v1/wallet/transfers", {
    method: "POST",
    body: JSON.stringify({ requestId: randomRequestId(), recipientNickname, amount }),
  }, token) as { walletBalance: number; duplicate: boolean };
  return body;
}

export async function getRoomChatMessages(token: string, roomId: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request(`/api/v1/chat/rooms/${roomId}/messages`, {}, token));
}

export async function getSupportMessages(token: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request("/api/v1/support/messages", {}, token));
}

export async function getAdminSupportConversations(token: string): Promise<SupportConversationList> {
  return supportConversationListSchema.parse(await request("/api/v1/admin/support/conversations", {}, token));
}

export async function getAdminSupportMessages(token: string, conversationId: string): Promise<ChatHistoryResponse> {
  return chatHistoryResponseSchema.parse(await request(`/api/v1/admin/support/conversations/${conversationId}/messages`, {}, token));
}
