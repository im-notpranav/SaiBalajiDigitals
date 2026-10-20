/**
 * WhatsApp outbox. Business code calls `queueWhatsApp` inside the same transaction as the
 * change it reports, so a message exists exactly when the change does. A background sender
 * delivers queued rows with retries; a WhatsApp outage can never fail a save or an approval.
 *
 * While WHATSAPP_MODE is "log" (the default) the sender marks rows LOGGED and prints them
 * instead of calling AskEva, so the whole flow can run before the account is ready.
 */
import type { Prisma, Role, WhatsAppStatus } from "@prisma/client";
import { prisma } from "../../utils/prisma";
import { WHATSAPP_LIVE } from "../../utils/config";
import { ProviderError, sendTemplate } from "./askeva";
import { WA_TEMPLATES, cleanParam, firstName, renderPreview, type WaEvent } from "./templates";

type Db = Prisma.TransactionClient | typeof prisma;
/** What a message is about. Jobs also name their order, for people who follow the order rather than the job. */
type Ref = { type: "payment_request" | "work_job" | "order"; id: number; orderId?: number | null };

/** The "Open in app" button's ending: {APP_URL}/go/<this>. */
export function linkFor(ref?: Ref): string | null {
  if (!ref) return null;
  if (ref.type === "payment_request") return `pr/${ref.id}`;
  if (ref.type === "order") return `order/${ref.id}`;
  return ref.orderId ? `job/${ref.id}/${ref.orderId}` : `job/${ref.id}`;
}

/**
 * A phone number in E.164, or null when it can't be one. Indian numbers may be stored as
 * 10 digits, with 0 or 91 in front, or with spaces; numbers already in +E.164 pass as-is.
 */
export function toE164(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  const indian = digits.replace(/^(91|0)(?=\d{10}$)/, "");
  if (/^[6-9]\d{9}$/.test(indian)) return `+91${indian}`;
  if (s.startsWith("+") && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

type Recipient = { id: number; name: string; phone: string | null; whatsapp_opt_out: boolean; is_active: boolean };

/** Where a message to this person can go, or why it can't. */
function routeFor(u: Recipient): { to_phone: string | null; status: WhatsAppStatus; error: string | null } {
  const to = toE164(u.phone);
  if (u.whatsapp_opt_out) return { to_phone: to, status: "SKIPPED", error: "Opted out of WhatsApp" };
  if (!to) return { to_phone: null, status: "SKIPPED", error: u.phone ? "Phone number is not a valid mobile number" : "No phone number" };
  return { to_phone: to, status: "QUEUED", error: null };
}

/**
 * Queue one template message per person. `params` are the template's variables after the
 * greeting ({{2}} onwards); {{1}} becomes each person's first name. Deactivated users and
 * duplicates are dropped; people without a usable number are logged as SKIPPED so the gap
 * shows up in the delivery log. Returns how many rows were written.
 */
export async function queueWhatsApp(
  db: Db,
  event: WaEvent,
  userIds: (number | null | undefined)[],
  params: unknown[],
  ref?: Ref,
): Promise<number> {
  const ids = [...new Set(userIds.filter((u): u is number => typeof u === "number"))];
  if (!ids.length) return 0;
  const def = WA_TEMPLATES[event];
  if (params.length !== def.vars.length) {
    console.warn(`WhatsApp ${event}: expected ${def.vars.length} variables, got ${params.length}`);
  }
  const rest = def.vars.map((_, i) => cleanParam(params[i]));

  const users = await db.user.findMany({
    where: { id: { in: ids }, is_active: true },
    select: { id: true, name: true, phone: true, whatsapp_opt_out: true, is_active: true },
  });
  if (!users.length) return 0;

  const now = new Date();
  const rows = users.map((u) => {
    const all = [firstName(u.name), ...rest];
    const route = routeFor(u);
    return {
      event,
      template: def.template,
      language: "en",
      user_id: u.id,
      to_phone: route.to_phone,
      params: all,
      preview: renderPreview(event, all),
      link: linkFor(ref),
      ref_type: ref?.type ?? null,
      ref_id: ref?.id ?? null,
      status: route.status,
      error: route.error,
      next_attempt_at: now,
    };
  });
  await db.whatsAppMessage.createMany({ data: rows });
  return rows.length;
}

/** Queue for everyone active in a role, leaving out the person who caused the event. */
export async function queueWhatsAppRole(
  db: Db,
  event: WaEvent,
  role: Role | undefined,
  params: unknown[],
  ref?: Ref,
  exceptUserId?: number,
): Promise<number> {
  if (!role) return 0;
  const users = await db.user.findMany({ where: { role, is_active: true }, select: { id: true } });
  return queueWhatsApp(db, event, users.map((u) => u.id).filter((id) => id !== exceptUserId), params, ref);
}

/**
 * For call sites that run after their transaction has committed: queue, but never let a
 * WhatsApp problem surface as an error to the person who made the change.
 */
export function queueWhatsAppAfter(event: WaEvent, userIds: (number | null | undefined)[], params: unknown[], ref?: Ref) {
  return queueWhatsApp(prisma, event, userIds, params, ref).catch((err) => {
    console.error(`WhatsApp ${event} could not be queued:`, err?.message ?? err);
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

const BATCH = 20;
const TICK_MS = 10_000;
export const MAX_ATTEMPTS = 5;
/** Minutes to wait after attempt 1, 2, 3, 4. */
const BACKOFF_MIN = [1, 5, 15, 60];
/** How long a claimed row is held before another sender may take it (crash safety). */
const LEASE_MIN = 5;

const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}…${p.slice(-4)}` : "no number");

type Claimed = { id: number; template: string; language: string; to_phone: string | null; params: unknown; preview: string; link: string | null; attempts: number };

/**
 * Claim due rows. SKIP LOCKED plus a short lease means two API instances never send the
 * same row, and a row claimed by a sender that crashed is picked up again later.
 *
 * Prisma stores timestamps as UTC without a zone, so "now" is taken in UTC too; plain now()
 * would follow the database's TimeZone setting and shift every wait by hours.
 */
async function claimBatch(): Promise<Claimed[]> {
  return prisma.$queryRaw<Claimed[]>`
    UPDATE "WhatsAppMessage"
       SET attempts = attempts + 1,
           next_attempt_at = (now() AT TIME ZONE 'UTC') + ${LEASE_MIN} * interval '1 minute',
           updated_at = (now() AT TIME ZONE 'UTC')
     WHERE id IN (
       SELECT id FROM "WhatsAppMessage"
        WHERE status = 'QUEUED' AND next_attempt_at <= (now() AT TIME ZONE 'UTC')
        ORDER BY id
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
    RETURNING id, template, language, to_phone, params, preview, link, attempts`;
}

async function deliver(row: Claimed) {
  const now = new Date();
  if (!WHATSAPP_LIVE) {
    console.log(`[whatsapp:log] #${row.id} ${row.template} → ${maskPhone(row.to_phone)}: ${row.preview}`);
    await prisma.whatsAppMessage.updateMany({ where: { id: row.id, status: "QUEUED" }, data: { status: "LOGGED", error: null } });
    return;
  }
  try {
    const { providerId } = await sendTemplate({
      to: row.to_phone!,
      template: row.template,
      language: row.language,
      params: (row.params as string[]) ?? [],
      link: row.link,
    });
    await prisma.whatsAppMessage.updateMany({
      where: { id: row.id, status: "QUEUED" },
      data: {
        status: "SENT",
        sent_at: now,
        // Without AskEva's id the row can't be matched to delivery reports, but it did go.
        provider_message_id: providerId ?? `noid-${row.id}`,
        error: providerId ? null : "AskEva returned no message id; delivery reports can't be matched",
      },
    });
  } catch (err) {
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const message = err instanceof Error ? err.message : String(err);
    const giveUp = !retryable || row.attempts >= MAX_ATTEMPTS;
    const wait = BACKOFF_MIN[Math.min(row.attempts, BACKOFF_MIN.length) - 1] ?? 60;
    await prisma.whatsAppMessage.updateMany({
      where: { id: row.id, status: "QUEUED" },
      data: giveUp
        ? { status: "FAILED", failed_at: now, error: message }
        : { next_attempt_at: new Date(now.getTime() + wait * 60_000), error: message },
    });
  }
}

let running = false;

/** One pass of the sender. Exported so checks can run it without waiting for the timer. */
export async function sendDueMessages(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    let total = 0;
    for (;;) {
      const batch = await claimBatch();
      for (const row of batch) {
        if (!row.to_phone) {
          await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: "SKIPPED", error: "No phone number" } });
          continue;
        }
        await deliver(row);
      }
      total += batch.length;
      if (batch.length < BATCH) return total;
    }
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startWhatsAppSender() {
  if (timer) return;
  console.log(`WhatsApp sender started (${WHATSAPP_LIVE ? "live via AskEva" : "log only, nothing is sent"})`);
  timer = setInterval(() => {
    sendDueMessages().catch((err) => console.error("WhatsApp sender pass failed:", err?.message ?? err));
  }, TICK_MS);
  timer.unref();
}

// ---------------------------------------------------------------------------
// Admin actions and delivery reports
// ---------------------------------------------------------------------------

/**
 * Put a failed or skipped message back in the queue, looking the person's number and
 * opt-out up again (the usual fix is adding a phone number). Returns the new status.
 */
export async function requeueMessage(id: number): Promise<WhatsAppStatus | null> {
  const msg = await prisma.whatsAppMessage.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, phone: true, whatsapp_opt_out: true, is_active: true } } },
  });
  if (!msg || (msg.status !== "FAILED" && msg.status !== "SKIPPED")) return null;
  const route = msg.user
    ? routeFor(msg.user)
    : { to_phone: msg.to_phone, status: (msg.to_phone ? "QUEUED" : "SKIPPED") as WhatsAppStatus, error: msg.to_phone ? null : "No phone number" };
  const res = await prisma.whatsAppMessage.updateMany({
    where: { id, status: msg.status },
    data: { status: route.status, to_phone: route.to_phone, error: route.error, attempts: 0, next_attempt_at: new Date(), failed_at: null },
  });
  return res.count ? route.status : null;
}

/** Which statuses a delivery report may move a message on from. Reports can arrive out of order. */
const MOVES_FROM: Record<"DELIVERED" | "READ" | "FAILED", WhatsAppStatus[]> = {
  DELIVERED: ["SENT"],
  READ: ["SENT", "DELIVERED"],
  FAILED: ["SENT", "DELIVERED"],
};

/** Apply one delivery report from AskEva. Returns whether a message changed. */
export async function applyDeliveryReport(providerId: string, status: string, at: Date, error?: string | null): Promise<boolean> {
  const to = status.toLowerCase() === "delivered" ? "DELIVERED" : status.toLowerCase() === "read" ? "READ" : status.toLowerCase() === "failed" ? "FAILED" : null;
  if (!to) return false;
  const data: Prisma.WhatsAppMessageUpdateManyMutationInput =
    to === "DELIVERED" ? { status: to, delivered_at: at } : to === "READ" ? { status: to, read_at: at } : { status: to, failed_at: at, error: error || "WhatsApp could not deliver it" };
  const res = await prisma.whatsAppMessage.updateMany({ where: { provider_message_id: providerId, status: { in: MOVES_FROM[to] } }, data });
  return res.count > 0;
}

const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "STOP ALL", "OPT OUT"]);
const START_WORDS = new Set(["START", "SUBSCRIBE", "OPT IN"]);

/**
 * A person replied STOP or START on WhatsApp: turn their messages off or back on.
 * Matches every account carrying that number. Returns how many accounts changed.
 */
export async function applyOptReply(fromDigits: string, text: string): Promise<number> {
  const word = text.trim().toUpperCase().replace(/\s+/g, " ");
  const optOut = STOP_WORDS.has(word) ? true : START_WORDS.has(word) ? false : null;
  const phone = toE164(`+${fromDigits.replace(/\D/g, "")}`);
  if (optOut === null || !phone) return 0;
  const local = phone.startsWith("+91") ? phone.slice(3) : null;
  const res = await prisma.user.updateMany({
    where: { OR: [{ phone }, ...(local ? [{ phone: local }] : [])], whatsapp_opt_out: !optOut },
    data: { whatsapp_opt_out: optOut },
  });
  return res.count;
}
