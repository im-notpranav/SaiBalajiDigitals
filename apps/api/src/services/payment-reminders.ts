/**
 * The daily nudge for overdue payment requests: once a day (after 09:30 India time, not on
 * Sundays) each person with something overdue gets one in-app notification listing it.
 * Cost Control hears about what waits on Cost Control, requesters about their own replies and
 * bills, and the Admin about everything. Safe to run often: it checks for today's note first.
 */
import { prisma } from "../utils/prisma";
import { getSetting } from "../utils/app-settings";
import { OPEN_PAYMENT_STATUSES } from "../utils/payment-workflow";
import { paymentTimers, type PaymentTimer } from "../utils/payment-timers";

export const DIGEST_TITLE = "Overdue payment requests";
const SEND_FROM_IST_MINUTE = 9 * 60 + 30;
const IST_MS = 330 * 60_000;
const SHOWN = 5;

/** Midnight at the start of today, India time. */
const istDayStart = (now: Date) => new Date(Math.floor((now.getTime() + IST_MS) / 86_400_000) * 86_400_000 - IST_MS);

/** Writes today's notes; returns how many people got one. */
export async function sendOverdueDigests(now = new Date()): Promise<number> {
  const threshold = await getSetting("payment_overdue_days");
  const open = await prisma.paymentRequest.findMany({
    where: { status: { in: OPEN_PAYMENT_STATUSES } },
    select: {
      request_no: true,
      requested_by: true,
      status: true,
      bill_details_required: true,
      status_changed_at: true,
      created_at: true,
      _count: { select: { attachments: { where: { deleted_at: null, kind: "BILL" } } } },
    },
  });

  const overdue: { request_no: string; requested_by: number; timer: PaymentTimer }[] = [];
  for (const r of open) {
    for (const t of paymentTimers(r, r._count.attachments, threshold, now)) {
      if (t.overdue) overdue.push({ request_no: r.request_no, requested_by: r.requested_by, timer: t });
    }
  }
  if (!overdue.length) return 0;

  const reviewers = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "COST_CONTROL_MANAGER"] }, is_active: true },
    select: { id: true, role: true },
  });
  const lines = new Map<number, typeof overdue>();
  const add = (userId: number, o: (typeof overdue)[number]) => lines.set(userId, [...(lines.get(userId) ?? []), o]);
  for (const o of overdue) {
    for (const u of reviewers) {
      if (u.role === "ADMIN" || o.timer.owner === "COST_CONTROL_MANAGER") add(u.id, o);
    }
    if (o.timer.owner === "REQUESTER") add(o.requested_by, o);
  }

  // One note per person per day, however often this runs or however many servers run it.
  const already = await prisma.notification.findMany({
    where: { title: DIGEST_TITLE, user_id: { in: [...lines.keys()] }, created_at: { gte: istDayStart(now) } },
    select: { user_id: true },
  });
  const done = new Set(already.map((n) => n.user_id));
  const active = new Set(
    (await prisma.user.findMany({ where: { id: { in: [...lines.keys()] }, is_active: true }, select: { id: true } })).map((u) => u.id),
  );

  const notes = [...lines.entries()]
    .filter(([userId]) => !done.has(userId) && active.has(userId))
    .map(([userId, items]) => {
      const sorted = [...items].sort((a, b) => b.timer.days - a.timer.days);
      const listed = sorted
        .slice(0, SHOWN)
        .map((o) => `${o.request_no} (${o.timer.label.toLowerCase()}, ${o.timer.days} days)`)
        .join("; ");
      const more = sorted.length > SHOWN ? `; and ${sorted.length - SHOWN} more` : "";
      const n = sorted.length;
      return {
        user_id: userId,
        title: DIGEST_TITLE,
        body: `${n} ${n === 1 ? "item has" : "items have"} waited more than ${threshold} working days: ${listed}${more}.`,
        kind: "warning",
      };
    });
  if (notes.length) await prisma.notification.createMany({ data: notes });
  return notes.length;
}

let timer: NodeJS.Timeout | null = null;

/** Checks every 15 minutes; sends once the day's 09:30 has passed (India time), Sundays off. */
export function startPaymentReminders() {
  if (timer) return;
  const tick = () => {
    const ist = new Date(Date.now() + IST_MS);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (ist.getUTCDay() === 0 || minute < SEND_FROM_IST_MINUTE) return;
    sendOverdueDigests().catch((err) => console.error("Overdue payment reminders failed:", err?.message ?? err));
  };
  timer = setInterval(tick, 15 * 60_000);
  timer.unref();
  setTimeout(tick, 30_000).unref();
}
