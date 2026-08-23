import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  username: string;
  role: "user" | "admin";
  exp?: number;
}

export interface AuthRequest extends Request {
  user: AuthUser;
}

export const REFRESH_COOKIE = "golden_rt";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function createToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: "30m", issuer: "golden-casino" });
}

export function verifyToken(token: string): AuthUser {
  const value = jwt.verify(token, config.jwtSecret, { issuer: "golden-casino" });
  if (typeof value === "string" || !value.id || !value.username || !value.role) throw new Error("Invalid token payload");
  return { id: String(value.id), username: String(value.username), role: value.role as AuthUser["role"], exp: value.exp };
}

/** Creates a long-lived refresh JWT carrying only a `jti`; the jti is what gets stored/revoked server-side. */
export function createRefreshToken(): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ jti }, config.jwtSecret, { expiresIn: "30d", issuer: "golden-casino", subject: jti });
  return { token, jti };
}

export function verifyRefreshToken(token: string): { jti: string } {
  const value = jwt.verify(token, config.jwtSecret, { issuer: "golden-casino" });
  if (typeof value === "string" || !value.jti) throw new Error("Invalid refresh token");
  return { jti: String(value.jti) };
}

/** Express's `res.cookie` is available without cookie-parser; reading needs manual parsing of the raw header. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "인증이 필요합니다." });
    return;
  }
  try {
    (req as AuthRequest).user = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ message: "로그인이 만료되었습니다." });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthRequest).user.role !== "admin") {
    res.status(403).json({ message: "관리자만 이용할 수 있습니다." });
    return;
  }
  next();
}
