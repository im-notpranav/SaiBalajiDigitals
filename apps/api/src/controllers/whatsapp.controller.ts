import { Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Prisma, WhatsAppStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { APP_URL, ASKEVA_SEND_URL, ASKEVA_TOKEN, ASKEVA_WEBHOOK_SECRET, WHATSAPP_LIVE, WHATSAPP_MODE } from "../utils/config";
import { applyDeliveryReport, applyOptReply, requeueMessage, toE164 } from "../services/whatsapp/outbox";
import { WA_BUTTON_TEXT, WA_TEMPLATES, sampleLink, type WaEvent } from "../services/whatsapp/templates";

const STATUSES: WhatsAppStatus[] = ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED", "LOGGED"];
const PAGE = 50;

/** Compares secrets without leaking their length or content through timing. */
function sameSecret(given: unknown, expected: string): boolean {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ admin */

/** GET /api/whatsapp/messages?status=&q=&page= — the delivery log, newest first. */
export const listMessages = async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status ?? "").toUpperCase() as WhatsAppStatus;
    const q = String(req.query.q ?? "").trim().slice(0, 60);
    const page = Math.max(1, Math.min(1000, Number.parseInt(String(req.query.page ?? "1"), 10) || 1));

    const where: Prisma.WhatsAppMessageWhereInput = {
      ...(STATUSES.includes(status) ? { status } : {}),
      ...(q
        ? {
            OR: [
              { preview: { contains: q, mode: "insensitive" } },
              { to_phone: { contains: q } },
              { template: { contains: q, mode: "insensitive" } },
              { user: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [rows, total, grouped] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
      prisma.whatsAppMessage.count({ where }),
      prisma.whatsAppMessage.groupBy({ by: ["status"], where: { created_at: { gte: since } }, _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<WhatsAppStatus, number>;
    for (const g of grouped) counts[g.status] = g._count._all;

    return res.json({
      messages: rows.map((m) => ({
        id: m.id,
        event: m.event,
        template: m.template,
        user: m.user,
        to_phone: m.to_phone,
        preview: m.preview,
        link: m.link ? `${APP_URL}/go/${m.link}` : null,
        ref_type: m.ref_type,
        ref_id: m.ref_id,
        status: m.status,
        attempts: m.attempts,
        error: m.error,
        created_at: m.created_at,
        sent_at: m.sent_at,
        delivered_at: m.delivered_at,
        read_at: m.read_at,
        failed_at: m.failed_at,
        can_retry: m.status === "FAILED" || m.status === "SKIPPED",
      })),
      total,
      page,
      page_size: PAGE,
      counts_30d: counts,
    });
  } catch (err) {
    console.error("listMessages failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/whatsapp/setup — mode, templates to create in AskEva, and who can't get messages yet. */
export const setupInfo = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { is_active: true },
      select: { id: true, name: true, role: true, phone: true, whatsapp_opt_out: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    const noPhone = users.filter((u) => !toE164(u.phone));
    let sendHost = "";
    try {
      sendHost = new URL(ASKEVA_SEND_URL).host;
    } catch {
      sendHost = "invalid ASKEVA_SEND_URL";
    }

    return res.json({
      mode: WHATSAPP_MODE,
      live: WHATSAPP_LIVE,
      token_set: !!ASKEVA_TOKEN,
      webhook_secret_set: !!ASKEVA_WEBHOOK_SECRET,
      send_host: sendHost,
      webhook_path: "/api/webhooks/askeva",
      app_url: APP_URL,
      button: { text: WA_BUTTON_TEXT, url: `${APP_URL}/go/{{1}}` },
      templates: Object.entries(WA_TEMPLATES).map(([event, t]) => ({
        event,
        template: t.template,
        body: t.body,
        vars: ["First name", ...t.vars],
        button_sample: sampleLink(event as WaEvent),
        category: "Utility",
        language: "en",
      })),
      people: {
        active: users.length,
        with_phone: users.length - noPhone.length,
        opted_out: users.filter((u) => u.whatsapp_opt_out).length,
        missing_phone: noPhone.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      },
    });
  } catch (err) {
    console.error("setupInfo failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/whatsapp/messages/:id/retry — send a failed or skipped message again. */
export const retryMessage = async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid message id" });
  try {
    const status = await requeueMessage(id);
    if (!status) return res.status(409).json({ message: "Only failed or skipped messages can be sent again." });
    return res.json({
      status,
      message:
        status === "QUEUED"
          ? "Queued to send again."
          : "Still can't be sent: the person has no valid phone number or has opted out.",
    });
  } catch (err) {
    console.error("retryMessage failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* ------------------------------------------------------------------ webhook */

/**
 * GET /api/webhooks/askeva — the Meta-style handshake: answer the challenge when the
 * verify token matches our secret.
 */
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = String(req.query["hub.challenge"] ?? "");
  if (mode === "subscribe" && sameSecret(token, ASKEVA_WEBHOOK_SECRET) && /^[\w.-]{1,200}$/.test(challenge)) {
    return res.type("text/plain").send(challenge);
  }
  return res.status(403).type("text/plain").send("Forbidden");
};

const MAX_ITEMS = 200;

/** Collects delivery reports and incoming messages from Meta-shaped (or flatter) payloads. */
function collect(body: any): { statuses: any[]; inbound: any[] } {
  const statuses: any[] = [];
  const inbound: any[] = [];
  const values: any[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const e of entries) {
    for (const c of Array.isArray(e?.changes) ? e.changes : []) if (c?.value) values.push(c.value);
  }
  if (!entries.length && body && typeof body === "object") values.push(body.value ?? body);
  for (const v of values) {
    if (Array.isArray(v?.statuses)) statuses.push(...v.statuses);
    if (Array.isArray(v?.messages)) inbound.push(...v.messages);
  }
  return { statuses: statuses.slice(0, MAX_ITEMS), inbound: inbound.slice(0, MAX_ITEMS) };
}

/**
 * POST /api/webhooks/askeva?key=SECRET — delivery reports (delivered / read / failed) and
 * STOP / START replies. Always answers 200 once the key checks out, so AskEva doesn't
 * keep resending reports we can't match.
 */
export const receiveWebhook = async (req: Request, res: Response) => {
  if (!ASKEVA_WEBHOOK_SECRET) return res.status(503).json({ message: "Webhook is not configured" });
  // Prefer the header (kept out of access logs); fall back to ?key= so existing AskEva setups work.
  const presented = req.get("x-webhook-secret") ?? req.query.key;
  if (!sameSecret(presented, ASKEVA_WEBHOOK_SECRET)) return res.status(403).json({ message: "Forbidden" });

  let updated = 0;
  let optChanges = 0;
  try {
    const { statuses, inbound } = collect(req.body);
    for (const s of statuses) {
      const id = typeof s?.id === "string" ? s.id : typeof s?.message_id === "string" ? s.message_id : null;
      if (!id || typeof s?.status !== "string") continue;
      const secs = Number(s.timestamp);
      const at = Number.isFinite(secs) && secs > 1e9 ? new Date(secs * 1000) : new Date();
      const e = Array.isArray(s.errors) ? s.errors[0] : null;
      const error = e ? String(e.error_data?.details ?? e.message ?? e.title ?? "").slice(0, 300) : null;
      if (await applyDeliveryReport(id, s.status, at, error)) updated++;
    }
    for (const m of inbound) {
      const text = m?.text?.body ?? m?.button?.text ?? m?.interactive?.button_reply?.title;
      if (typeof m?.from === "string" && typeof text === "string" && text.length <= 40) {
        optChanges += await applyOptReply(m.from, text);
      }
    }
  } catch (err) {
    console.error("AskEva webhook failed:", err);
  }
  return res.json({ ok: true, updated, opt_changes: optChanges });
};
