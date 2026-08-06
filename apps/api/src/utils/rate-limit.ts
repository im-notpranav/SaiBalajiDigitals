/**
 * Rate-limit key resolution.
 *
 * In production the API is reached through a Cloudflare Pages Function, which
 * forwards the browser's address as `x-real-client-ip`. Without this, every
 * request appears to originate from the proxy and all users share one bucket.
 */
import type { Request } from "express";

export function clientIpKey(req: Request): string {
  return req.get("x-real-client-ip") || req.ip || "unknown";
}
