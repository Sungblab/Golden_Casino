import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { registerRequestSchema } from "@golden/contracts";
import { pool } from "../database/pool.js";
import {
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_MS,
  clearRefreshCookie,
  createRefreshToken,
  createToken,
  readCookie,
  requireAuth,
  setRefreshCookie,
  verifyRefreshToken,
  type AuthRequest,
} from "./auth.js";

const loginSchema = z.object({ username: z.string().min(2).max(40), password: z.string().min(8).max(100) });
export const authRouter = Router();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginAllowed(key: string): boolean {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 8;
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "아이디, 닉네임, 비밀번호를 확인해주세요." });
  const { username, nickname, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      "INSERT INTO users (username,nickname,password_hash,approved) VALUES ($1,$2,$3,false) RETURNING id",
      [username, nickname, passwordHash],
    );
    const userId = inserted.rows[0]!.id;
    await client.query("INSERT INTO wallet_accounts (kind,user_id) VALUES ('user',$1)", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "이미 사용 중인 아이디 또는 닉네임입니다." });
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json({ status: "pending" });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "아이디와 비밀번호를 확인해주세요." });
  const attemptKey = `${req.ip}:${parsed.data.username.toLowerCase()}`;
  if (!loginAllowed(attemptKey)) return res.status(429).json({ message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." });
  const result = await pool.query<{ id: string; username: string; nickname: string; password_hash: string; role: "user" | "admin"; approved: boolean }>(
    "SELECT id,username,nickname,password_hash,role,approved FROM users WHERE username=$1",
    [parsed.data.username],
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
  if (!user.approved) return res.status(403).json({ message: "관리자 승인을 기다리고 있습니다." });
  loginAttempts.delete(attemptKey);
  const publicUser = { id: user.id, username: user.username, nickname: user.nickname, role: user.role };
  const refresh = createRefreshToken();
  await pool.query("INSERT INTO refresh_tokens (id,user_id,expires_at) VALUES ($1,$2,now()+$3::interval)", [refresh.jti, user.id, `${REFRESH_TOKEN_TTL_MS} milliseconds`]);
  setRefreshCookie(res, refresh.token);
  return res.json({ token: createToken(publicUser), user: publicUser });
});

authRouter.post("/refresh", async (req, res) => {
  const cookie = readCookie(req, REFRESH_COOKIE);
  if (!cookie) return res.status(401).json({ message: "로그인이 필요합니다." });
  let jti: string;
  try {
    jti = verifyRefreshToken(cookie).jti;
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ message: "세션이 만료되었습니다. 다시 로그인해주세요." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{ user_id: string; revoked_at: string | null; expires_at: string }>(
      "SELECT user_id,revoked_at,expires_at FROM refresh_tokens WHERE id=$1 FOR UPDATE",
      [jti],
    );
    const current = row.rows[0];
    if (!current || current.revoked_at || new Date(current.expires_at).getTime() <= Date.now()) {
      await client.query("COMMIT");
      clearRefreshCookie(res);
      return res.status(401).json({ message: "세션이 만료되었습니다. 다시 로그인해주세요." });
    }
    const user = await client.query<{ id: string; username: string; nickname: string; role: "user" | "admin"; approved: boolean }>(
      "SELECT id,username,nickname,role,approved FROM users WHERE id=$1",
      [current.user_id],
    );
    if (!user.rows[0]?.approved) {
      await client.query("COMMIT");
      clearRefreshCookie(res);
      return res.status(401).json({ message: "이용 승인이 취소되었습니다." });
    }
    const next = createRefreshToken();
    await client.query("INSERT INTO refresh_tokens (id,user_id,expires_at) VALUES ($1,$2,now()+$3::interval)", [next.jti, current.user_id, `${REFRESH_TOKEN_TTL_MS} milliseconds`]);
    await client.query("UPDATE refresh_tokens SET revoked_at=now(),replaced_by=$2 WHERE id=$1", [jti, next.jti]);
    await client.query("COMMIT");
    setRefreshCookie(res, next.token);
    const publicUser = { id: user.rows[0].id, username: user.rows[0].username, nickname: user.rows[0].nickname, role: user.rows[0].role };
    return res.json({ token: createToken(publicUser), user: publicUser });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

authRouter.post("/logout", async (req, res) => {
  const cookie = readCookie(req, REFRESH_COOKIE);
  clearRefreshCookie(res);
  if (!cookie) return res.json({ status: "ok" });
  try {
    const { jti } = verifyRefreshToken(cookie);
    await pool.query("UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [jti]);
  } catch {
    // Already invalid/expired: nothing to revoke.
  }
  res.json({ status: "ok" });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = (req as AuthRequest).user;
  res.json({ user });
});
