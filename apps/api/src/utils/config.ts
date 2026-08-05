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
