/**
 * Rate-limit key resolution.
 *
 * In production the API is reached through a Cloudflare Pages Function, which
 * forwards the browser's address as `x-real-client-ip`. Without this, every
 * request appears to originate from the proxy and all users share one bucket.
 */
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET, PROXY_SHARED_SECRET } from "./config";

/**
 * True when the request carries the Worker's shared secret — i.e. it really came through
 * Cloudflare, so its forwarded `x-real-client-ip` can be believed. When no secret is
 * configured we keep trusting the header (the previous behaviour), so nothing breaks before
 * the secret is set in both Cloudflare and Render.
 */
function fromTrustedProxy(req: Request): boolean {
  if (!PROXY_SHARED_SECRET) return true;
  const given = req.get("x-proxy-auth") || "";
  if (given.length !== PROXY_SHARED_SECRET.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given), Buffer.from(PROXY_SHARED_SECRET));
  } catch {
    return false;
  }
}

export function clientIpKey(req: Request): string {
  // Only believe the forwarded address when the request proves it came through our Worker.
  // Otherwise fall back to the socket address, so hitting the Render origin directly and
  // rotating `x-real-client-ip` no longer grants extra login/rate-limit buckets.
  if (fromTrustedProxy(req)) {
    const forwarded = req.get("x-real-client-ip");
    if (forwarded) return forwarded;
  }
  return req.ip || "unknown";
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
