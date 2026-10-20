import { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { leaveSchema, leaveCancelSchema, dayQuery } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { isFieldRole } from "../utils/roles";
import { notifyUser } from "../services/notifications.service";
import { addDays, dayKey, daysBetween, findLeaveClashes, isLeaveOverlapViolation, lockPeople, parseDay, todayIST } from "../utils/work-allocation";

/**
 * Leave register for field staff (the old "Leave Details" sheet). Leave blocks allocation:
 * a job cannot take someone on leave, and recording leave over existing jobs needs an
 * explicit "save anyway". Cancelled leave is kept for history.
 */

class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

function sendError(res: Response, err: any) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.body });
  if (isLeaveOverlapViolation(err)) {
    return res.status(409).json({ message: "This person already has leave on some of these days. Reload and try again." });
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

const leaveInclude = {
  user: { select: { id: true, name: true, role: true, phone: true, emp_code: true } },
  creator: { select: { id: true, name: true } },
  canceller: { select: { id: true, name: true } },
} satisfies Prisma.LeaveRecordInclude;

type LeaveRow = Prisma.LeaveRecordGetPayload<{ include: typeof leaveInclude }>;

export function serializeLeave(l: LeaveRow, today = todayIST()) {
  const from = dayKey(l.from_date);
  const to = dayKey(l.to_date);
  return {
    id: l.id,
    user: l.user,
    from_date: from,
    to_date: to,
    days: daysBetween(from, to) + 1,
    reason: l.reason,
    state: l.cancelled_at ? "CANCELLED" : to < today ? "PAST" : from > today ? "UPCOMING" : "CURRENT",
    creator: l.creator,
    created_at: l.created_at,
    cancelled_at: l.cancelled_at,
    canceller: l.canceller,
    cancel_reason: l.cancel_reason,
  };
}

/** "21 Oct" or "21 – 23 Oct". */
const fmtRange = (from: string, to: string) => {
  const fmt = (d: string) => parseDay(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
};

/** Longest single leave record. Longer absences are entered as several records. */
const MAX_LEAVE_DAYS = 120;

/**
 * Validate a create/edit payload and refuse clashes with the person's other leave, or with
 * jobs they are on unless the manager acknowledged them.
 */
async function resolveLeaveInput(tx: Prisma.TransactionClient, body: unknown, excludeLeaveId?: number) {
  const parsed = leaveSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid input", { errors: sanitizeZodErrors(parsed.error) });
  const input = parsed.data;
  const from = input.from_date;
  const to = input.to_date || input.from_date;
  if (daysBetween(from, to) + 1 > MAX_LEAVE_DAYS) {
    throw new HttpError(400, `One leave record can cover at most ${MAX_LEAVE_DAYS} days. Enter longer leave as several records.`);
  }

  const person = await tx.user.findUnique({ where: { id: input.user_id }, select: { id: true, name: true, role: true, is_active: true } });
  if (!person || !isFieldRole(person.role)) throw new HttpError(400, "Leave is recorded for Pasters, Helpers and Drivers only.");
  if (!person.is_active) throw new HttpError(400, `${person.name} is deactivated.`);

  await lockPeople(tx, [person.id]);

  const own = await findLeaveClashes(tx, { userIds: [person.id], start: from, end: to, excludeLeaveId });
  if (own.length) {
    throw new HttpError(409, `${person.name} already has leave on ${fmtRange(own[0].from_date, own[0].to_date)}. Edit that record instead.`, {
      leave_conflicts: own,
    });
  }

  const slots = await tx.workJobMember.findMany({
    where: {
      user_id: person.id,
      job: { status: { not: "CANCELLED" } },
      start_date: { lte: parseDay(to) },
      end_date: { gte: parseDay(from) },
    },
    include: { job: { select: { id: true, job_no: true, work_details: true, start_date: true, end_date: true, status: true } } },
    orderBy: { start_date: "asc" },
  });
  const jobs = slots.map((s) => ({
    job_id: s.job.id,
    job_no: s.job.job_no,
    work_details: s.job.work_details,
    status: s.job.status,
    start_date: dayKey(s.job.start_date),
    end_date: dayKey(s.job.end_date),
  }));
  if (jobs.length && !input.acknowledge_jobs) {
    throw new HttpError(
      409,
      `${person.name} is on ${jobs.length === 1 ? "a job" : `${jobs.length} jobs`} over these dates (${jobs.map((j) => j.job_no).join(", ")}). Change the team first, or save the leave anyway.`,
      { job_conflicts: jobs },
    );
  }

  return { person, from, to, reason: input.reason || null, jobs };
}

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

export const listLeave = async (req: Request, res: Response) => {
  try {
    const today = todayIST();
    const from = dayQuery.safeParse(req.query.from).success ? String(req.query.from) : addDays(today, -30);
    const to = dayQuery.safeParse(req.query.to).success ? String(req.query.to) : addDays(today, 60);
    const where: Prisma.LeaveRecordWhereInput = { from_date: { lte: parseDay(to) }, to_date: { gte: parseDay(from) } };
    if (req.query.user_id) where.user_id = parseId(req.query.user_id);
    if (req.query.include_cancelled !== "1") where.cancelled_at = null;
    const rows = await prisma.leaveRecord.findMany({ where, include: leaveInclude, orderBy: [{ from_date: "asc" }, { id: "asc" }], take: 500 });
    return res.status(200).json({ from, to, leave: rows.map((l) => serializeLeave(l, today)) });
  } catch (err) {
    return sendError(res, err);
  }
};

export const createLeave = async (req: Request, res: Response) => {
  try {
    const leave = await withAudit(req.user!.id, async (tx) => {
      const r = await resolveLeaveInput(tx, req.body);
      return tx.leaveRecord.create({
        data: { user_id: r.person.id, from_date: parseDay(r.from), to_date: parseDay(r.to), reason: r.reason, created_by: req.user!.id },
        include: leaveInclude,
      });
    });
    const s = serializeLeave(leave);
    await notifyUser(leave.user_id, "Leave recorded", `${fmtRange(s.from_date, s.to_date)}${s.reason ? ` · ${s.reason}` : ""}`, "info", null).catch(() => {});
    return res.status(201).json(s);
  } catch (err) {
    return sendError(res, err);
  }
};

export const updateLeave = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const leave = await withAudit(req.user!.id, async (tx) => {
      const current = await tx.leaveRecord.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Leave record not found");
      if (current.cancelled_at) throw new HttpError(400, "Cancelled leave cannot be edited. Record new leave instead.");
      const r = await resolveLeaveInput(tx, req.body, id);
      if (r.person.id !== current.user_id) throw new HttpError(400, "Leave cannot be moved to another person. Cancel it and record new leave.");
      return tx.leaveRecord.update({
        where: { id },
        data: { from_date: parseDay(r.from), to_date: parseDay(r.to), reason: r.reason },
        include: leaveInclude,
      });
    });
    const s = serializeLeave(leave);
    await notifyUser(leave.user_id, "Leave changed", `Now ${fmtRange(s.from_date, s.to_date)}${s.reason ? ` · ${s.reason}` : ""}`, "info", null).catch(() => {});
    return res.status(200).json(s);
  } catch (err) {
    return sendError(res, err);
  }
};

export const cancelLeave = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const parsed = leaveCancelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const leave = await withAudit(req.user!.id, async (tx) => {
      const current = await tx.leaveRecord.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Leave record not found");
      if (current.cancelled_at) throw new HttpError(400, "This leave is already cancelled.");
      return tx.leaveRecord.update({
        where: { id },
        data: { cancelled_at: new Date(), cancelled_by: req.user!.id, cancel_reason: parsed.data.reason },
        include: leaveInclude,
      });
    });
    const s = serializeLeave(leave);
    await notifyUser(leave.user_id, "Leave cancelled", `${fmtRange(s.from_date, s.to_date)} is no longer leave. ${parsed.data.reason}`, "warning", null).catch(() => {});
    return res.status(200).json(s);
  } catch (err) {
    return sendError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Field staff: their own leave
// ---------------------------------------------------------------------------

export const myLeave = async (req: Request, res: Response) => {
  try {
    const today = todayIST();
    const rows = await prisma.leaveRecord.findMany({
      where: { user_id: req.user!.id, cancelled_at: null, to_date: { gte: parseDay(addDays(today, -30)) } },
      include: leaveInclude,
      orderBy: { from_date: "asc" },
    });
    return res.status(200).json({
      today,
      leave: rows.map((l) => {
        const s = serializeLeave(l, today);
        return { id: s.id, from_date: s.from_date, to_date: s.to_date, days: s.days, reason: s.reason, state: s.state };
      }),
    });
  } catch (err) {
    return sendError(res, err);
  }
};
