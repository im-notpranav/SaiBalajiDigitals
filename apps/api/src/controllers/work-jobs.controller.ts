import { Request, Response } from "express";
import type { Prisma, WorkJobStatus } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { workJobSchema, workJobStatusSchema, myJobStatusSchema, dayQuery } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { FIELD_ROLES, isFieldRole } from "../utils/roles";
import { notifyUser } from "../services/notifications.service";
import { queueWhatsAppAfter } from "../services/whatsapp/outbox";
import {
  EDITABLE_STATUSES,
  MAX_JOB_DAYS,
  STATUS_TRANSITIONS,
  addDays,
  blocksCalendar,
  dayKey,
  daysBetween,
  findConflicts,
  findLeaveClashes,
  gridLabel,
  isOverlapViolation,
  lockPeople,
  lockRows,
  parseDay,
  teamLimitErrors,
  todayIST,
} from "../utils/work-allocation";

/**
 * Field work jobs: the Operation Manager's replacement for the old Task Log sheet.
 *
 * A job belongs to one order, runs over whole days, and carries a team of Pasters,
 * Helpers and a Driver. Nobody may be booked on two overlapping jobs unless the job says
 * "Allow 2nd job" — checked here for a readable answer, and enforced again by an exclusion
 * constraint in the database so two managers saving at once cannot both win.
 */

class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

const jobInclude = {
  order: { select: { id: true, order_no: true, client_name: true, status: true, created_by: true, creator_name: true } },
  area: { select: { id: true, name: true, locality: true } },
  vehicle: { select: { id: true, reg_no: true, type: true } },
  csmCode: { select: { id: true, code: true, kind: true, label: true, user: { select: { id: true, name: true } } } },
  csm2Code: { select: { id: true, code: true, kind: true, label: true, user: { select: { id: true, name: true } } } },
  creator: { select: { id: true, name: true } },
  starter: { select: { id: true, name: true } },
  completer: { select: { id: true, name: true } },
  members: {
    include: { user: { select: { id: true, name: true, phone: true, role: true } } },
    orderBy: [{ slot_role: "asc" as const }, { id: "asc" as const }],
  },
  stores: { include: { orderStore: { select: { id: true, s_no: true, store_name: true, location: true } } } },
} satisfies Prisma.WorkJobInclude;

type JobRow = Prisma.WorkJobGetPayload<{ include: typeof jobInclude }>;

export function serializeJob(job: JobRow) {
  return {
    id: job.id,
    status: job.status,
    start_date: dayKey(job.start_date),
    end_date: dayKey(job.end_date),
    days: daysBetween(dayKey(job.start_date), dayKey(job.end_date)) + 1,
    work_details: job.work_details,
    locality: job.locality,
    route: job.route,
    extra_tag: job.extra_tag,
    instructions: job.instructions,
    allow_double_booking: job.allow_double_booking,
    label: gridLabel(job),
    order: job.order,
    area: job.area,
    vehicle: job.vehicle,
    csm_code: job.csmCode,
    csm2_code: job.csm2Code,
    creator: job.creator,
    members: job.members.map((m) => ({ user_id: m.user_id, name: m.user.name, phone: m.user.phone, slot_role: m.slot_role })),
    stores: job.stores.map((s) => s.orderStore).sort((a, b) => a.s_no - b.s_no),
    started_at: job.started_at,
    started_by: job.starter,
    completed_at: job.completed_at,
    completed_by: job.completer,
    completion_note: job.completion_note,
    cancelled_at: job.cancelled_at,
    cancel_reason: job.cancel_reason,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function sendError(res: Response, err: any) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.body });
  if (isOverlapViolation(err)) {
    return res.status(409).json({ message: "Someone on this team was just booked on another job for these dates. Reload and try again." });
  }
  console.error(err);
  return res.status(500).json({ message: "Internal server error" });
}

const parseId = (raw: unknown) => {
  const id = parseInt(String(raw), 10);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  return id;
};

async function withAudit<T>(userId: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId.toString()}, true)`;
    return fn(tx);
  });
}

/**
 * Check a create/edit payload against the database and turn it into the values to store.
 * Throws HttpError with a message a manager can act on.
 */
async function resolveJobInput(
  tx: Prisma.TransactionClient,
  body: unknown,
  current?: { id: number; start: string; end: string; memberIds: number[] },
) {
  const excludeJobId = current?.id;
  const parsed = workJobSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid input", { errors: sanitizeZodErrors(parsed.error) });
  const input = parsed.data;
  const start = input.start_date;
  const end = input.end_date || input.start_date;
  if (daysBetween(start, end) + 1 > MAX_JOB_DAYS) {
    throw new HttpError(400, `A job can run at most ${MAX_JOB_DAYS} days. Split longer work into several jobs.`);
  }

  const order = await tx.order.findUnique({ where: { id: input.order_id }, select: { id: true, order_no: true, client_name: true, created_by: true } });
  if (!order) throw new HttpError(400, "That order does not exist.");

  if (input.store_ids.length) {
    const stores = await tx.orderStore.findMany({ where: { id: { in: input.store_ids }, order_id: order.id }, select: { id: true } });
    if (stores.length !== new Set(input.store_ids).size) throw new HttpError(400, "Some of the chosen stores are not on this order.");
  }

  const area = await tx.area.findUnique({ where: { id: input.area_id } });
  if (!area || !area.is_active) throw new HttpError(400, "Pick an active area.");

  if (input.vehicle_id) {
    const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicle_id } });
    if (!vehicle || !vehicle.is_active) throw new HttpError(400, "Pick an active vehicle.");
  }

  // Default the CSM code to the one linked to the CSM who raised the order.
  let csmCodeId = input.csm_code_id ?? null;
  if (!csmCodeId && order.created_by) {
    const own = await tx.csmCode.findFirst({ where: { user_id: order.created_by, kind: "CSM", is_active: true }, orderBy: { code: "asc" } });
    csmCodeId = own?.id ?? null;
  }
  for (const id of [csmCodeId, input.csm2_code_id].filter(Boolean) as number[]) {
    const code = await tx.csmCode.findUnique({ where: { id } });
    if (!code || !code.is_active) throw new HttpError(400, "Pick an active CSM code.");
  }

  const people = await tx.user.findMany({
    where: { id: { in: input.member_ids } },
    select: { id: true, name: true, role: true, is_active: true },
  });
  if (people.length !== input.member_ids.length) throw new HttpError(400, "One of the chosen people does not exist.");
  const notField = people.filter((p) => !isFieldRole(p.role));
  if (notField.length) throw new HttpError(400, `${notField.map((p) => p.name).join(", ")} is not a Paster, Helper or Driver.`);
  const inactive = people.filter((p) => !p.is_active);
  if (inactive.length) throw new HttpError(400, `${inactive.map((p) => p.name).join(", ")} is deactivated.`);
  const limitErrors = teamLimitErrors(people.map((p) => p.role));
  if (limitErrors.length) throw new HttpError(400, limitErrors.join(" "));

  // Queue behind any other save touching these people (jobs, leave, overtime).
  await lockPeople(tx, input.member_ids);

  // Leave is a hard stop: "Allow 2nd job" does not override it. On an edit, people already
  // on the job are re-checked only when the dates change, so a job can still be edited
  // after leave was recorded over it on purpose.
  const datesChanged = !current || current.start !== start || current.end !== end;
  const leaveCheckIds = datesChanged ? input.member_ids : input.member_ids.filter((m) => !current!.memberIds.includes(m));
  const onLeave = await findLeaveClashes(tx, { userIds: leaveCheckIds, start, end });
  if (onLeave.length) {
    const names = [...new Set(onLeave.map((l) => l.name))].join(", ");
    throw new HttpError(409, `${names} ${onLeave.length === 1 ? "is" : "are"} on leave on these dates. Pick someone else or change the dates.`, {
      leave_conflicts: onLeave,
    });
  }

  if (!input.allow_double_booking) {
    const conflicts = await findConflicts(tx, { userIds: input.member_ids, start, end, excludeJobId });
    if (conflicts.length) {
      const names = [...new Set(conflicts.map((c) => c.name))].join(", ");
      throw new HttpError(409, `${names} already ${conflicts.length === 1 ? "has" : "have"} work on these dates. Change the team or dates, or tick "Allow 2nd job".`, { conflicts });
    }
  }

  return {
    order,
    area,
    people,
    start,
    end,
    data: {
      order_id: order.id,
      start_date: parseDay(start),
      end_date: parseDay(end),
      csm_code_id: csmCodeId,
      csm2_code_id: input.csm2_code_id ?? null,
      work_details: input.work_details,
      area_id: area.id,
      locality: area.locality,
      vehicle_id: input.vehicle_id ?? null,
      route: input.route || null,
      extra_tag: input.extra_tag ? input.extra_tag.toUpperCase() : null,
      instructions: input.instructions || null,
      allow_double_booking: input.allow_double_booking,
    },
    store_ids: [...new Set(input.store_ids)],
  };
}

/** Plain-language summary for notifications: "ORD260123 · Big C Kurnool board fixing · Kurnool · 21–23 Oct". */
function jobSummary(job: JobBrief) {
  return `${job.order.order_no} · ${job.work_details} · ${job.area.name} · ${jobWhen(job)}`;
}

type JobBrief = { id: number; work_details: string; area: { name: string }; start_date: Date; end_date: Date; order: { id: number; order_no: string } };

/** "21 Oct" or "21 Oct – 23 Oct". */
function jobWhen(job: Pick<JobBrief, "start_date" | "end_date">) {
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return dayKey(job.start_date) === dayKey(job.end_date) ? fmt(job.start_date) : `${fmt(job.start_date)} – ${fmt(job.end_date)}`;
}

/** Order number, work, area and dates: the shared variables of the field-staff WhatsApp templates. */
const jobVars = (job: JobBrief) => [job.order.order_no, job.work_details, job.area.name, jobWhen(job)];
const jobRef = (job: JobBrief) => ({ type: "work_job" as const, id: job.id, orderId: job.order.id });

/** Tell field staff about their jobs (no order link: they have no order page to open). */
async function notifyPeople(userIds: number[], title: string, body: string, kind = "info") {
  await Promise.all(userIds.map((id) => notifyUser(id, title, body, kind, null).catch((e) => console.error("notify failed", e))));
}

/** The CSM who should hear about a job: the code's linked user, else whoever raised the order. */
const csmUserOf = (job: JobRow) => job.csmCode?.user?.id ?? job.order.created_by ?? null;

// ---------------------------------------------------------------------------
// List / read
// ---------------------------------------------------------------------------

export const listJobs = async (req: Request, res: Response) => {
  try {
    const from = dayQuery.safeParse(req.query.from).success ? String(req.query.from) : addDays(todayIST(), -7);
    const to = dayQuery.safeParse(req.query.to).success ? String(req.query.to) : addDays(todayIST(), 14);
    // Looking up one order's work (from its order page) means all of it, whatever the dates.
    const wholeOrder = !!req.query.order_id && !req.query.from && !req.query.to;
    const where: Prisma.WorkJobWhereInput = wholeOrder
      ? {}
      : { start_date: { lte: parseDay(to) }, end_date: { gte: parseDay(from) } };
    if (req.query.status) {
      where.status = { in: String(req.query.status).split(",").filter(Boolean) as WorkJobStatus[] };
    }
    if (req.query.user_id) where.members = { some: { user_id: parseId(req.query.user_id) } };
    if (req.query.area_id) where.area_id = parseId(req.query.area_id);
    if (req.query.csm_code_id) {
      const id = parseId(req.query.csm_code_id);
      where.OR = [{ csm_code_id: id }, { csm2_code_id: id }];
    }
    if (req.query.locality === "LOCAL" || req.query.locality === "NON_LOCAL") where.locality = req.query.locality;
    if (req.query.order_id) where.order_id = parseId(req.query.order_id);
    if (req.query.q) {
      const q = String(req.query.q);
      where.AND = [{
        OR: [
          // Numbers issued before jobs went by their order's number still find the job.
          { job_no: { contains: q, mode: "insensitive" } },
          { work_details: { contains: q, mode: "insensitive" } },
          { order: { order_no: { contains: q, mode: "insensitive" } } },
          { order: { client_name: { contains: q, mode: "insensitive" } } },
        ],
      }];
    }

    const jobs = await prisma.workJob.findMany({
      where,
      include: jobInclude,
      orderBy: [{ start_date: "asc" }, { id: "asc" }],
      take: 500,
    });
    return res.status(200).json({ from, to, jobs: jobs.map(serializeJob) });
  } catch (err) {
    return sendError(res, err);
  }
};

export const getJob = async (req: Request, res: Response) => {
  try {
    const job = await prisma.workJob.findUnique({ where: { id: parseId(req.params.id) }, include: jobInclude });
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.status(200).json(serializeJob(job));
  } catch (err) {
    return sendError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

export const createJob = async (req: Request, res: Response) => {
  try {
    const job = await withAudit(req.user!.id, async (tx) => {
      const r = await resolveJobInput(tx, req.body);
      const blocks = blocksCalendar({ status: "ASSIGNED", allow_double_booking: r.data.allow_double_booking });
      return tx.workJob.create({
        data: {
          ...r.data,
          created_by: req.user!.id,
          members: {
            create: r.people.map((p) => ({
              user_id: p.id,
              slot_role: p.role,
              start_date: r.data.start_date,
              end_date: r.data.end_date,
              blocks_calendar: blocks,
            })),
          },
          stores: { create: r.store_ids.map((order_store_id) => ({ order_store_id })) },
        },
        include: jobInclude,
      });
    });

    await notifyPeople(job.members.map((m) => m.user_id), `New job on ${job.order.order_no}`, jobSummary(job));
    await queueWhatsAppAfter("JOB_ASSIGNED", job.members.map((m) => m.user_id), jobVars(job), jobRef(job));
    const csm = csmUserOf(job);
    if (csm) {
      const team = job.members.map((m) => m.user.name).join(", ");
      await notifyUser(csm, `Team assigned for ${job.order.order_no}`, `${jobSummary(job)} — ${team}`, "info", job.order.id).catch(() => {});
      await queueWhatsAppAfter(
        "JOB_UPDATE",
        [csm],
        [job.order.order_no, job.work_details, "assigned", `${job.area.name}, ${jobWhen(job)}. Team: ${team || "none yet"}`],
        jobRef(job),
      );
    }
    return res.status(201).json(serializeJob(job));
  } catch (err) {
    return sendError(res, err);
  }
};

export const updateJob = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const { job, added, removed } = await withAudit(req.user!.id, async (tx) => {
      await lockRows(tx, "WorkJob", [id]);
      const current = await tx.workJob.findUnique({ where: { id }, include: { members: true } });
      if (!current) throw new HttpError(404, "Job not found");
      if (!EDITABLE_STATUSES.includes(current.status)) {
        throw new HttpError(400, `A ${current.status.toLowerCase()} job cannot be edited.${current.status === "COMPLETED" ? " Reopen it first." : ""}`);
      }
      const r = await resolveJobInput(tx, req.body, {
        id,
        start: dayKey(current.start_date),
        end: dayKey(current.end_date),
        memberIds: current.members.map((m) => m.user_id),
      });
      const blocks = blocksCalendar({ status: current.status, allow_double_booking: r.data.allow_double_booking });
      const before = new Set(current.members.map((m) => m.user_id));
      const after = new Set(r.people.map((p) => p.id));
      const removed = [...before].filter((u) => !after.has(u));
      const added = [...after].filter((u) => !before.has(u));

      if (removed.length) await tx.workJobMember.deleteMany({ where: { job_id: id, user_id: { in: removed } } });
      // Kept members take the new dates and booking state.
      await tx.workJobMember.updateMany({
        where: { job_id: id },
        data: { start_date: r.data.start_date, end_date: r.data.end_date, blocks_calendar: blocks },
      });
      for (const p of r.people.filter((p) => added.includes(p.id))) {
        await tx.workJobMember.create({
          data: { job_id: id, user_id: p.id, slot_role: p.role, start_date: r.data.start_date, end_date: r.data.end_date, blocks_calendar: blocks },
        });
      }
      await tx.workJobStore.deleteMany({ where: { job_id: id } });
      if (r.store_ids.length) await tx.workJobStore.createMany({ data: r.store_ids.map((order_store_id) => ({ job_id: id, order_store_id })) });

      const job = await tx.workJob.update({ where: { id }, data: r.data, include: jobInclude });
      return { job, added, removed };
    });

    if (added.length) {
      await notifyPeople(added, `New job on ${job.order.order_no}`, jobSummary(job));
      await queueWhatsAppAfter("JOB_ASSIGNED", added, jobVars(job), jobRef(job));
    }
    if (removed.length) {
      await notifyPeople(removed, `Removed from the job on ${job.order.order_no}`, `You are no longer on ${jobSummary(job)}.`, "warning");
      await queueWhatsAppAfter("JOB_REMOVED", removed, jobVars(job), jobRef(job));
    }
    return res.status(200).json(serializeJob(job));
  } catch (err) {
    return sendError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const setJobStatus = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const parsed = workJobStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const { status, reason } = parsed.data;

    const { job, from } = await withAudit(req.user!.id, async (tx) => {
      await lockRows(tx, "WorkJob", [id]);
      const current = await tx.workJob.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Job not found");
      if (!STATUS_TRANSITIONS[current.status].includes(status)) {
        throw new HttpError(400, `A job that is ${current.status.toLowerCase()} cannot be moved to ${status.toLowerCase()}.`);
      }
      const now = new Date();
      const data: Prisma.WorkJobUncheckedUpdateInput = { status };
      if (status === "STARTED" && !current.started_at) {
        data.started_at = now;
        data.started_by = req.user!.id;
      }
      if (status === "COMPLETED") {
        data.completed_at = now;
        data.completed_by = req.user!.id;
      }
      if (current.status === "COMPLETED") {
        // Reopened: the earlier completion no longer stands.
        data.completed_at = null;
        data.completed_by = null;
        data.completion_note = null;
      }
      if (status === "CANCELLED") {
        data.cancelled_at = now;
        data.cancel_reason = reason ?? null;
      }
      // Reopening a completed job, or un-holding, re-books its people; make sure that is
      // still possible before saving. Cancelling frees them.
      const blocks = blocksCalendar({ status, allow_double_booking: current.allow_double_booking });
      if (blocks && !current.allow_double_booking) {
        const members = await tx.workJobMember.findMany({ where: { job_id: id }, select: { user_id: true } });
        const conflicts = await findConflicts(tx, {
          userIds: members.map((m) => m.user_id),
          start: dayKey(current.start_date),
          end: dayKey(current.end_date),
          excludeJobId: id,
        });
        if (conflicts.length) throw new HttpError(409, "Someone on this team has been booked elsewhere for these dates.", { conflicts });
      }
      await tx.workJobMember.updateMany({ where: { job_id: id }, data: { blocks_calendar: blocks } });
      const job = await tx.workJob.update({ where: { id }, data, include: jobInclude });
      return { job, from: current.status };
    });

    if (status === "CANCELLED") {
      await notifyPeople(job.members.map((m) => m.user_id), `Job on ${job.order.order_no} cancelled`, `${jobSummary(job)}. Reason: ${reason}`, "warning");
      await queueWhatsAppAfter("JOB_CANCELLED", job.members.map((m) => m.user_id), [...jobVars(job), reason], jobRef(job));
    }
    const csm = csmUserOf(job);
    if (csm && (status === "COMPLETED" || status === "HOLD" || status === "CANCELLED" || (status === "STARTED" && from === "ASSIGNED"))) {
      await notifyUser(csm, `Job on ${job.order.order_no} ${status === "HOLD" ? "on hold" : status.toLowerCase()}`, jobSummary(job), status === "COMPLETED" ? "success" : "info", job.order.id).catch(() => {});
      await queueWhatsAppAfter(
        "JOB_UPDATE",
        [csm],
        [job.order.order_no, job.work_details, status === "HOLD" ? "on hold" : status.toLowerCase(), reason || `${job.area.name}, ${jobWhen(job)}`],
        jobRef(job),
      );
    }
    return res.status(200).json(serializeJob(job));
  } catch (err) {
    return sendError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Pickers and boards
// ---------------------------------------------------------------------------

/** Orders to pick from when creating a job: the newest first, with their stores. */
export const orderOptions = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const orders = await prisma.order.findMany({
      where: q
        ? {
            OR: [
              { order_no: { contains: q, mode: "insensitive" } },
              { client_name: { contains: q, mode: "insensitive" } },
              { stores: { some: { store_name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {},
      select: {
        id: true,
        order_no: true,
        client_name: true,
        status: true,
        created_by: true,
        creator_name: true,
        stores: { select: { id: true, s_no: true, store_name: true, location: true }, orderBy: { s_no: "asc" } },
      },
      orderBy: { id: "desc" },
      take: 20,
    });
    // The CSM code each order's creator uses, so the form can pre-fill it.
    const creatorIds = [...new Set(orders.map((o) => o.created_by).filter(Boolean) as number[])];
    const codes = await prisma.csmCode.findMany({ where: { user_id: { in: creatorIds }, kind: "CSM", is_active: true }, orderBy: { code: "asc" } });
    const codeFor = new Map<number, { id: number; code: string }>();
    for (const c of codes) if (c.user_id && !codeFor.has(c.user_id)) codeFor.set(c.user_id, { id: c.id, code: c.code });
    return res.status(200).json({
      orders: orders.map((o) => ({ ...o, csm_code: o.created_by ? (codeFor.get(o.created_by) ?? null) : null })),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

const staffSelect = { id: true, name: true, role: true, phone: true, emp_code: true } as const;

/** One day: who is free, who is on which job, and every job running that day. */
export const dailyBoard = async (req: Request, res: Response) => {
  try {
    const date = dayQuery.safeParse(req.query.date).success ? String(req.query.date) : todayIST();
    const day = parseDay(date);
    const [staff, jobs, leave] = await Promise.all([
      prisma.user.findMany({ where: { role: { in: [...FIELD_ROLES] }, is_active: true }, select: staffSelect, orderBy: { name: "asc" } }),
      prisma.workJob.findMany({
        where: { status: { not: "CANCELLED" }, start_date: { lte: day }, end_date: { gte: day } },
        include: jobInclude,
        orderBy: { id: "asc" },
      }),
      prisma.leaveRecord.findMany({ where: { cancelled_at: null, status: "APPROVED", from_date: { lte: day }, to_date: { gte: day } } }),
    ]);
    const leaveByUser = new Map(leave.map((l) => [l.user_id, { id: l.id, from_date: dayKey(l.from_date), to_date: dayKey(l.to_date), reason: l.reason }]));
    const jobsByUser = new Map<number, { job_id: number; order_no: string; label: string }[]>();
    for (const j of jobs) {
      for (const m of j.members) {
        const list = jobsByUser.get(m.user_id) ?? [];
        list.push({ job_id: j.id, order_no: j.order.order_no, label: gridLabel(j) });
        jobsByUser.set(m.user_id, list);
      }
    }
    const people = staff.map((s) => ({ ...s, jobs: jobsByUser.get(s.id) ?? [], leave: leaveByUser.get(s.id) ?? null }));
    const free = (role: string) => people.filter((p) => p.role === role && p.jobs.length === 0 && !p.leave);
    return res.status(200).json({
      date,
      counts: {
        jobs: jobs.length,
        free_pasters: free("PASTER").length,
        free_helpers: free("HELPER").length,
        free_drivers: free("DRIVER").length,
        busy: people.filter((p) => p.jobs.length > 0).length,
        double_booked: people.filter((p) => p.jobs.length > 1).length,
        on_leave: people.filter((p) => p.leave).length,
      },
      free: { PASTER: free("PASTER"), HELPER: free("HELPER"), DRIVER: free("DRIVER") },
      busy: people.filter((p) => p.jobs.length > 0),
      // Everyone on leave; those also on a job that day were booked before the leave.
      on_leave: people.filter((p) => p.leave),
      jobs: jobs.map(serializeJob),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/** The weekly grid (the old WAS sheet): one row per person, one cell per day. */
export const weeklyGrid = async (req: Request, res: Response) => {
  try {
    const from = dayQuery.safeParse(req.query.from).success ? String(req.query.from) : addDays(todayIST(), -1);
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? "7"), 10) || 7, 1), 31);
    const to = addDays(from, days - 1);
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));

    const [staff, jobs, leave] = await Promise.all([
      prisma.user.findMany({ where: { role: { in: [...FIELD_ROLES] }, is_active: true }, select: staffSelect, orderBy: { name: "asc" } }),
      prisma.workJob.findMany({
        where: { status: { not: "CANCELLED" }, start_date: { lte: parseDay(to) }, end_date: { gte: parseDay(from) } },
        include: { csmCode: { select: { code: true } }, csm2Code: { select: { code: true } }, order: { select: { order_no: true } }, members: { select: { user_id: true } } },
      }),
      prisma.leaveRecord.findMany({ where: { cancelled_at: null, status: "APPROVED", from_date: { lte: parseDay(to) }, to_date: { gte: parseDay(from) } } }),
    ]);
    const onLeave = new Set<string>(); // `${user}|${date}`
    for (const l of leave) {
      for (let d = dayKey(l.from_date) < from ? from : dayKey(l.from_date); d <= (dayKey(l.to_date) > to ? to : dayKey(l.to_date)); d = addDays(d, 1)) {
        onLeave.add(`${l.user_id}|${d}`);
      }
    }

    type Cell = { job_id: number; order_no: string; label: string; status: WorkJobStatus };
    const cells = new Map<string, Cell[]>(); // `${user}|${date}`
    for (const j of jobs) {
      const s = dayKey(j.start_date) < from ? from : dayKey(j.start_date);
      const e = dayKey(j.end_date) > to ? to : dayKey(j.end_date);
      for (let d = s; d <= e; d = addDays(d, 1)) {
        for (const m of j.members) {
          const key = `${m.user_id}|${d}`;
          const list = cells.get(key) ?? [];
          list.push({ job_id: j.id, order_no: j.order.order_no, label: gridLabel(j), status: j.status });
          cells.set(key, list);
        }
      }
    }

    const roleOrder = { PASTER: 0, HELPER: 1, DRIVER: 2 } as Record<string, number>;
    const rows = staff
      .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name))
      .map((s) => ({
        ...s,
        days: dates.map((d) => cells.get(`${s.id}|${d}`) ?? []),
        leave: dates.map((d) => onLeave.has(`${s.id}|${d}`)),
      }));
    const freeCount = (role: string, i: number) => rows.filter((r) => r.role === role && r.days[i].length === 0 && !r.leave[i]).length;

    return res.status(200).json({
      from,
      to,
      dates,
      rows,
      free: dates.map((_, i) => ({ PASTER: freeCount("PASTER", i), HELPER: freeCount("HELPER", i), DRIVER: freeCount("DRIVER", i) })),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Field staff: their own jobs
// ---------------------------------------------------------------------------

/** A Paster / Helper / Driver's own jobs: everything not cancelled from two weeks back on. */
export const myJobs = async (req: Request, res: Response) => {
  try {
    const since = parseDay(addDays(todayIST(), -14));
    const jobs = await prisma.workJob.findMany({
      where: { members: { some: { user_id: req.user!.id } }, status: { not: "CANCELLED" }, end_date: { gte: since } },
      include: jobInclude,
      orderBy: [{ start_date: "asc" }, { id: "asc" }],
    });
    // Field staff see who to call and where to go, never order amounts.
    const csmIds = [...new Set(jobs.map((j) => csmUserOf(j)).filter(Boolean) as number[])];
    const csms = await prisma.user.findMany({ where: { id: { in: csmIds } }, select: { id: true, name: true, phone: true } });
    const csmById = new Map(csms.map((c) => [c.id, c]));
    return res.status(200).json({
      today: todayIST(),
      jobs: jobs.map((j) => {
        const s = serializeJob(j);
        const csmId = csmUserOf(j);
        return {
          ...s,
          order: { order_no: j.order.order_no, client_name: j.order.client_name },
          csm: csmId ? (csmById.get(csmId) ?? null) : null,
        };
      }),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/**
 * A Paster / Helper / Driver marks their own job started (from its start date on) or
 * completed (once started). Anything else — hold, cancel, reopen — stays with managers.
 * Someone not on the job gets a 404, so job ids cannot be probed.
 */
export const myJobStatus = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const parsed = myJobStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const { status, note } = parsed.data;
    const me = req.user!.id;

    const job = await withAudit(me, async (tx) => {
      await lockRows(tx, "WorkJob", [id]);
      const current = await tx.workJob.findFirst({ where: { id, members: { some: { user_id: me } } } });
      if (!current) throw new HttpError(404, "Job not found");
      const now = new Date();
      if (status === "STARTED") {
        if (current.status !== "ASSIGNED") throw new HttpError(400, `This job is ${current.status.toLowerCase()}, so it cannot be started.`);
        if (dayKey(current.start_date) > todayIST()) {
          throw new HttpError(400, `This job starts on ${dayKey(current.start_date)}. You can mark it started from that day.`);
        }
        return tx.workJob.update({ where: { id }, data: { status, started_at: current.started_at ?? now, started_by: me }, include: jobInclude });
      }
      if (current.status !== "STARTED") {
        throw new HttpError(400, current.status === "ASSIGNED" ? "Mark the job started first." : `This job is ${current.status.toLowerCase()}, so it cannot be completed.`);
      }
      return tx.workJob.update({
        where: { id },
        data: { status, completed_at: now, completed_by: me, completion_note: note || null },
        include: jobInclude,
      });
    });

    // The CSM and whoever assigned the job hear about it; the order link is for them.
    const who = job.members.find((m) => m.user_id === me)?.user.name ?? "A team member";
    const title = `Job on ${job.order.order_no} ${status === "STARTED" ? "started" : "completed"} by ${who}`;
    const body = `${jobSummary(job)}${status === "COMPLETED" && note ? ` — "${note}"` : ""}`;
    const tell = [...new Set([csmUserOf(job), job.created_by].filter((u): u is number => !!u && u !== me))];
    await Promise.all(tell.map((u) => notifyUser(u, title, body, status === "COMPLETED" ? "success" : "info", job.order.id).catch(() => {})));
    await queueWhatsAppAfter(
      "JOB_UPDATE",
      tell,
      [job.order.order_no, job.work_details, status === "STARTED" ? "started" : "completed", `Marked by ${who}${status === "COMPLETED" && note ? `: ${note}` : ""}`],
      jobRef(job),
    );

    return res.status(200).json(serializeJob(job));
  } catch (err) {
    return sendError(res, err);
  }
};
