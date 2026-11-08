/**
 * One place that mints the session cookie, so login, profile update and logout always agree on
 * its flags and lifetime. The cookie's max-age follows JWT_EXPIRES_IN instead of a hardcoded
 * 7 days, so the browser forgets the cookie exactly when the token stops being valid (F10).
 */
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN, NODE_ENV } from "./config";

/** Parse a jwt-style duration ("7d", "24h", "30m", "10s", or bare seconds) to milliseconds. */
export function expiresInMs(spec: string): number {
  const fallback = 7 * 24 * 60 * 60 * 1000;
  const m = /^(\d+)\s*([smhd])?$/.exec(String(spec).trim());
  if (!m) return fallback;
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(m[1]) * (mult[m[2] ?? "s"] ?? 1000);
}

export const AUTH_COOKIE_MAX_AGE_MS = expiresInMs(JWT_EXPIRES_IN);

/** Flags shared by set and clear so a later clear actually matches (and so removes) the cookie. */
const COOKIE_FLAGS = {
  httpOnly: true,
  secure: NODE_ENV === "production",
  sameSite: "strict" as const,
};

export interface TokenUser {
  id: number;
  username: string;
  name: string;
  role: string;
}

/** Sign a session token for `user` and set it as the auth cookie. Returns the token. */
export function issueAuthCookie(res: Response, user: TokenUser): string {
  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as any },
  );
  res.cookie("token", token, { ...COOKIE_FLAGS, maxAge: AUTH_COOKIE_MAX_AGE_MS });
  return token;
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie("token", COOKIE_FLAGS);
}
