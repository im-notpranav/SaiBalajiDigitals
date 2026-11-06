/**
 * Rate-limit key resolution.
 *
 * In production the API is reached through a Cloudflare Pages Function, which
 * forwards the browser's address as `x-real-client-ip`. Without this, every
 * request appears to originate from the proxy and all users share one bucket.
 */
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config";

export function clientIpKey(req: Request): string {
  return req.get("x-real-client-ip") || req.ip || "unknown";
}

/**
 * One bucket per signed-in person. The whole office shares one address, so counting by address
 * would let a few busy people lock out everyone else. The token is verified, not just read,
 * because an unchecked one could name anybody and so escape the limit. Signed-out requests still
 * count by address.
 */
export function userOrIpKey(req: Request): string {
  const token = req.cookies?.token;
  if (token) {
    try {
      return `user:${(jwt.verify(token, JWT_SECRET) as { id: number }).id}`;
    } catch {
      // An expired or forged token is the same as none.
    }
  }
  return clientIpKey(req);
}

/** Failed logins count per person per address: one person's typos must not stop the office. */
export function loginKey(req: Request): string {
  const username = String(req.body?.username ?? "").trim().toLowerCase().slice(0, 100);
  return `${clientIpKey(req)}:${username}`;
}
