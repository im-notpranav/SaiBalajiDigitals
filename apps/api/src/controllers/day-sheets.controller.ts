import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { computeTotals } from "../utils/order-totals";
import { OPEN_STATUSES } from "../utils/order-status";

/**
 * Day sheets and the Operation Manager's pending board.
 *
 * Day sheet: one person's day. For a CSM it lists the orders they raised or changed that day
 * by itself, and they add rows for other work (follow-up, visit, call). For a paster or
 * helper it lists the jobs they were on, and they add a note of the work done. Admin and OM
 * read anyone's sheet; others read and write only their own.
 *
 * Pending board: open orders grouped by CSM and Hyderabad / Non-local, aged from the order
 * date: 0–5 days green, 6–10 orange, 11+ red, oldest first.
 */

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const VIEW_ALL = new Set(["ADMIN", "OPERATION_MANAGER"]);
const SHEET_ROLES = ["CSM", "PASTER", "HELPER", "DRIVER", "PRODUCTION"] as const;
export const ACTIVITIES = ["Follow-up", "Visit", "Call", "Meeting", "Note", "Other"] as const;

const dayParam = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayIst());
/** The UTC moments an IST day starts and ends. */
const istWindow = (day: string) => {
  const start = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
};

/** GET /api/day-sheets?user=&day=YYYY-MM-DD */
export const getDaySheet = async (req: Request, res: Response) => {
  const me = req.user!;
  const day = dayParam(req.query.day);
  const asked = Number(req.query.user);
  const userId = Number.isInteger(asked) && asked > 0 ? asked : me.id;
  if (userId !== me.id && !VIEW_ALL.has(me.role)) return res.status(403).json({ message: "You can see only your own day sheet." });
  try {
    const person = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } });
    if (!person) return res.status(404).json({ message: "No such person." });
    const { start, end } = istWindow(day);
    const date = new Date(`${day}T00:00:00.000Z`);
    const entries = await prisma.daySheetEntry.findMany({ where: { user_id: userId, day: date }, orderBy: [{ time: "asc" }, { created_at: "asc" }] });

    let orders: unknown[] = [];
    let jobs: unknown[] = [];
    if (person.role === "CSM" || person.role === "ADMIN" || person.role === "OPERATION_MANAGER") {
      const [created, changed] = await Promise.all([
        prisma.order.findMany({
          where: { created_by: userId, created_at: { gte: start, lt: end } },
          select: { id: true, order_no: true, client_name: true, status: true, items: true, adjustments: { where: { status: "Approved" } } },
        }),
        prisma.orderChangeLog.findMany({
          where: { changed_by: userId, changed_at: { gte: start, lt: end } },
          select: { order_id: true, field_changed: true },
        }),
      ]);
      const touchedIds = [...new Set(changed.map((c) => c.order_id))].filter((id) => !created.some((o) => o.id === id));
      const touched = touchedIds.length
        ? await prisma.order.findMany({ where: { id: { in: touchedIds } }, select: { id: true, order_no: true, client_name: true, status: true, items: true, adjustments: { where: { status: "Approved" } } } })
        : [];
      const fields = new Map<number, Set<string>>();
      for (const c of changed) fields.set(c.order_id, (fields.get(c.order_id) ?? new Set()).add(c.field_changed));
      orders = [
        ...created.map((o) => ({ id: o.id, order_no: o.order_no, client_name: o.client_name, status: o.status, value: computeTotals(o.items, o.adjustments).total_amount, what: "Raised" })),
        ...touched.map((o) => ({ id: o.id, order_no: o.order_no, client_name: o.client_name, status: o.status, value: computeTotals(o.items, o.adjustments).total_amount, what: `Changed: ${[...(fields.get(o.id) ?? [])].slice(0, 4).join(", ")}` })),
      ];
    }
    if (person.role === "PASTER" || person.role === "HELPER" || person.role === "DRIVER") {
      const rows = await prisma.workJob.findMany({
        where: { members: { some: { user_id: userId } }, start_date: { lte: date }, end_date: { gte: date } },
        select: {
          id: true,
          status: true,
          work_details: true,
          completion_note: true,
          locality: true,
          area: { select: { name: true } },
          order: { select: { id: true, order_no: true, client_name: true } },
        },
        orderBy: { id: "asc" },
      });
      jobs = rows.map((j) => ({
        id: j.id,
        status: j.status,
        order_id: j.order?.id ?? null,
        order_no: j.order?.order_no ?? null,
        client_name: j.order?.client_name ?? null,
        area: j.area?.name ?? null,
        work_details: j.work_details,
        completion_note: j.completion_note,
      }));
    }
    return res.json({ day, person, entries, orders, jobs, can_edit: userId === me.id });
  } catch (err) {
    console.error("getDaySheet", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const entrySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  activity: z.enum(ACTIVITIES).default("Note"),
  client_name: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().min(1, "Write what was done.").max(2000),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time as HH:MM").optional().nullable(),
  order_id: z.number().int().positive().optional().nullable(),
});

/** POST /api/day-sheets — a row on one's own sheet, for today or an earlier day. */
export const addDaySheetEntry = async (req: Request, res: Response) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
  const day = parsed.data.day ?? todayIst();
  if (day > todayIst()) return res.status(400).json({ message: "A day sheet is for today or an earlier day." });
  const entry = await prisma.daySheetEntry.create({
    data: {
      user_id: req.user!.id,
      day: new Date(`${day}T00:00:00.000Z`),
      activity: parsed.data.activity,
      client_name: parsed.data.client_name || null,
      note: parsed.data.note,
      time: parsed.data.time || null,
      order_id: parsed.data.order_id ?? null,
    },
  });
  return res.status(201).json({ entry });
};

/** PATCH /api/day-sheets/:id — one's own row. */
export const updateDaySheetEntry = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = entrySchema.partial().safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ message: "Invalid input" });
  const { day: _day, ...data } = parsed.data;
  const r = await prisma.daySheetEntry.updateMany({ where: { id, user_id: req.user!.id }, data });
  if (r.count === 0) return res.status(404).json({ message: "No row of yours with that id." });
  return res.json({ entry: await prisma.daySheetEntry.findUnique({ where: { id } }) });
};

/** DELETE /api/day-sheets/:id — one's own row. */
export const deleteDaySheetEntry = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
  const r = await prisma.daySheetEntry.deleteMany({ where: { id, user_id: req.user!.id } });
  if (r.count === 0) return res.status(404).json({ message: "No row of yours with that id." });
  return res.json({ ok: true });
};

/** GET /api/day-sheets/people — whose sheets Admin and OM can open, with how many rows that day. */
export const daySheetPeople = async (req: Request, res: Response) => {
  const day = dayParam(req.query.day);
  const [people, counts] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: [...SHEET_ROLES] }, is_active: true, deleted_at: null },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.daySheetEntry.groupBy({ by: ["user_id"], where: { day: new Date(`${day}T00:00:00.000Z`) }, _count: { _all: true } }),
  ]);
  const n = new Map(counts.map((c) => [c.user_id, c._count._all]));
  return res.json({ day, people: people.map((p) => ({ ...p, entries: n.get(p.id) ?? 0 })) });
};

// ---------------------------------------------------------------------------------------
// Pending board
// ---------------------------------------------------------------------------------------

/** Where an open order is stuck. Same rule as the web app's orderStage (apps/web/src/lib/order-stage.ts). */
function stageOf(o: { status: string; items: { production_completed: boolean; assignments: unknown[] }[] }) {
  if (o.status === "BillingCompleted" || o.status === "Pending") return "payment";
  if (o.status === "Installed") return "billing";
  const assigned = o.items.filter((i) => i.assignments.length > 0);
  if (assigned.length === 0) return "unassigned";
  return assigned.every((i) => i.production_completed) ? "installation" : "production";
}

export const ageTone = (days: number) => (days <= 5 ? "green" : days <= 10 ? "orange" : "red");

/** GET /api/dashboard/pending-by-csm */
export const getPendingByCsm = async (_req: Request, res: Response) => {
  try {
    const [orders, areas] = await Promise.all([
      prisma.order.findMany({
        where: { status: { in: OPEN_STATUSES }, merged_into_id: null },
        select: {
          id: true,
          order_no: true,
          client_name: true,
          date: true,
          status: true,
          created_by: true,
          creator_name: true,
          stores: { select: { location: true } },
          items: { include: { assignments: { select: { id: true } } } },
          adjustments: { where: { status: "Approved" } },
        },
        orderBy: { date: "asc" },
        take: 5000,
      }),
      prisma.area.findMany({ select: { name: true, locality: true } }),
    ]);
    const localityOf = new Map(areas.map((a) => [a.name.toLowerCase(), a.locality]));
    const now = Date.now();
    type Row = { id: number; order_no: string; client_name: string; date: string; status: string; stage: string; days: number; tone: string; value: number; locations: string };
    const groups = new Map<string, { csm_id: number | null; csm: string; local: Row[]; non_local: Row[] }>();
    for (const o of orders) {
      const days = Math.max(0, Math.floor((now - o.date.getTime()) / DAY_MS));
      const locs = [...new Set(o.stores.map((s) => s.location))];
      // An order with any store outside Hyderabad counts as Non-local.
      const nonLocal = locs.some((l) => localityOf.get(l.toLowerCase()) === "NON_LOCAL");
      const key = String(o.created_by ?? o.creator_name);
      const g = groups.get(key) ?? { csm_id: o.created_by, csm: o.creator_name, local: [], non_local: [] };
      (nonLocal ? g.non_local : g.local).push({
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        date: o.date.toISOString(),
        status: o.status,
        stage: stageOf(o),
        days,
        tone: ageTone(days),
        value: computeTotals(o.items, o.adjustments).total_amount,
        locations: locs.join(", "),
      });
      groups.set(key, g);
    }
    const csms = [...groups.values()]
      .map((g) => {
        const all = [...g.local, ...g.non_local];
        return {
          ...g,
          total: all.length,
          oldest: Math.max(0, ...all.map((r) => r.days)),
          tones: { green: all.filter((r) => r.tone === "green").length, orange: all.filter((r) => r.tone === "orange").length, red: all.filter((r) => r.tone === "red").length },
        };
      })
      .sort((a, b) => b.oldest - a.oldest || b.total - a.total);
    return res.json({ csms, total: orders.length });
  } catch (err) {
    console.error("getPendingByCsm", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
