/**
 * Central configuration module. Validates required environment variables at
 * import time so the server refuses to start if anything critical is missing.
 *
 * dotenv is loaded here (not in server.ts) because ES module imports are
 * hoisted — if server.ts calls dotenv.config() in module body, it runs
 * AFTER all static imports have already been evaluated.
 */
import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Set it in your .env file. See apps/api/.env.example for reference.`
    );
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

// ─── Required ────────────────────────────────────────────────────────────────

export const JWT_SECRET = required("JWT_SECRET");
export const DATABASE_URL = required("DATABASE_URL");

// ─── Optional with sensible defaults ─────────────────────────────────────────

export const JWT_EXPIRES_IN = optional("JWT_EXPIRES_IN", "7d");

/**
 * Shared secret the Cloudflare Worker sends on `x-proxy-auth` so the API can tell a request
 * really arrived through it. When set, the forwarded client address (`x-real-client-ip`) is
 * trusted only on requests carrying this secret — otherwise anyone hitting the Render origin
 * directly could forge that header and slip the login/rate limits (see utils/rate-limit.ts).
 *
 * Leave it empty to keep the previous behaviour (the forwarded header is always trusted).
 * Roll out in this order so the office is never locked into one rate-limit bucket:
 *   1. set the secret in Cloudflare and deploy the Worker (it starts sending the header),
 *   2. then set PROXY_SHARED_SECRET in Render.
 */
export const PROXY_SHARED_SECRET = process.env.PROXY_SHARED_SECRET || "";
export const PORT = optional("PORT", "3001");
export const NODE_ENV = optional("NODE_ENV", "development");
export const CLIENT_URL = optional("CLIENT_URL", "http://localhost:5173");
export const ADMIN_EMAIL = optional("ADMIN_EMAIL", "admin@saibalaji.com");

// ─── SMTP (warn, don't crash — emails will fail gracefully) ─────────────────

export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = process.env.SMTP_PORT || "587";
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";

if (!SMTP_HOST) {
  console.warn("⚠️  SMTP_HOST is not set — email notifications will not be sent.");
}

// ─── WhatsApp via AskEva (log-only until switched on) ───────────────────────

/** "live" sends through AskEva; anything else writes messages to the log only. */
export const WHATSAPP_MODE: "live" | "log" = process.env.WHATSAPP_MODE === "live" ? "live" : "log";
export const ASKEVA_SEND_URL = optional("ASKEVA_SEND_URL", "https://backend.askeva.io/v1/message/send-message");
export const ASKEVA_TOKEN = process.env.ASKEVA_TOKEN || "";
/** Shared secret for the delivery-report webhook (verify token and ?key= on the URL). */
export const ASKEVA_WEBHOOK_SECRET = process.env.ASKEVA_WEBHOOK_SECRET || "";
/** Where "Open in app" buttons lead: the web app's address (defaults to the first CLIENT_URL). */
export const APP_URL = (process.env.APP_URL || CLIENT_URL.split(",")[0] || "").trim().replace(/\/+$/, "");
/** Live only when asked for and a token is present; otherwise nothing leaves the server. */
export const WHATSAPP_LIVE = WHATSAPP_MODE === "live" && !!ASKEVA_TOKEN;

if (WHATSAPP_MODE === "live" && !ASKEVA_TOKEN) {
  console.warn("⚠️  WHATSAPP_MODE=live but ASKEVA_TOKEN is not set — WhatsApp messages will only be logged.");
}

// ─── File storage: Cloudflare R2 (warn, don't crash — uploads are refused) ──

export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
export const R2_BUCKET = process.env.R2_BUCKET || "";
/** Starts every key, so local files stay apart from production's in a shared bucket. */
export const R2_PREFIX = optional("R2_PREFIX", NODE_ENV === "production" ? "prod/" : "dev/");
export const R2_ENABLED = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);

if (!R2_ENABLED && NODE_ENV !== "test") {
  console.warn("⚠️  R2 is not fully set — new file uploads will be refused or kept in the database.");
}
