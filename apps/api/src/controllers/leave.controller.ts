import { Request, Response } from "express";
import type { LeaveStatus, Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { leaveSchema, leaveCancelSchema, leaveRequestSchema, leaveDecisionSchema, dayQuery } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { isFieldRole } from "../utils/roles";
import { notifyRole, notifyUser } from "../services/notifications.service";
import { addDays, dayKey, daysBetween, findLeaveClashes, isLeaveOverlapViolation, lockPeople, lockRows, parseDay, todayIST } from "../utils/work-allocation";

/** Admin and the Operation Manager both decide leave, so both hear about requests (GAP-A07). */
const notifyLeaveDeciders = (title: string, body: string) =>
  Promise.all((["ADMIN", "OPERATION_MANAGER"] as const).map((role) => notifyRole(role, title, body, "info", null).catch(() => {})));

/**
 * Leave register for field staff (the old "Leave Details" sheet). Field staff request their
 * own leave and the Operation Manager approves or rejects it; leave a manager records is
 * approved at once. Approved leave blocks allocation: a job cannot take someone on leave,
 * and approving leave over existing jobs needs an explicit "anyway". A pending request
 * holds the days against other leave but blocks nothing else. Cancelled and rejected leave
 * is kept for history.
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
  decider: { select: { id: true, name: true } },
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
    status: l.status,
    state: l.cancelled_at
      ? "CANCELLED"
      : l.status !== "APPROVED"
        ? l.status
        : to < today
          ? "PAST"
          : from > today
            ? "UPCOMING"
            : "CURRENT",
    /** Asked for by the person themself, not recorded by a manager. */
    requested: l.created_by === l.user_id,
    creator: l.creator,
    created_at: l.created_at,
    decider: l.decider,
    decided_at: l.decided_at,
    reject_reason: l.reject_reason,
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

function checkLength(from: string, to: string) {
  if (daysBetween(from, to) + 1 > MAX_LEAVE_DAYS) {
    throw new HttpError(400, `One leave record can cover at most ${MAX_LEAVE_DAYS} days. Enter longer leave as several records.`);
  }
}

/** Refuse leave that overlaps the person's other pending or approved leave. */
async function checkOwnLeave(tx: Prisma.TransactionClient, person: { id: number; name: string }, from: string, to: string, excludeLeaveId?: number, self = false) {
  const own = await findLeaveClashes(tx, { userIds: [person.id], start: from, end: to, excludeLeaveId, includePending: true });
  if (own.length) {
    const range = fmtRange(own[0].from_date, own[0].to_date);
    throw new HttpError(
      409,
      self ? `You already have leave asked for or approved on ${range}.` : `${person.name} already has leave on ${range}. Edit that record instead.`,
      { leave_conflicts: own },
    );
  }
}

/** Jobs the person is on over [from, to], for the "save anyway" warning. */
async function findJobClashes(tx: Prisma.TransactionClient, userId: number, from: string, to: string) {
  const slots = await tx.workJobMember.findMany({
    where: {
      user_id: userId,
      job: { status: { not: "CANCELLED" } },
      start_date: { lte: parseDay(to) },
      end_date: { gte: parseDay(from) },
    },
    include: { job: { select: { id: true, work_details: true, start_date: true, end_date: true, status: true, order: { select: { order_no: true } } } } },
    orderBy: { start_date: "asc" },
  });
  return slots.map((s) => ({
    job_id: s.job.id,
    order_no: s.job.order?.order_no ?? null,
    work_details: s.job.work_details,
    status: s.job.status,
    start_date: dayKey(s.job.start_date),
    end_date: dayKey(s.job.end_date),
  }));
}

async function refuseJobClashes(tx: Prisma.TransactionClient, person: { id: number; name: string }, from: string, to: string, verb: string) {
  const jobs = await findJobClashes(tx, person.id, from, to);
  if (jobs.length) {
    throw new HttpError(
      409,
      `${person.name} is on ${jobs.length === 1 ? "a job" : `${jobs.length} jobs`} over these dates (${jobs.map((j) => j.order_no ?? "no order yet").join(", ")}). Change the team first, or ${verb} the leave anyway.`,
      { job_conflicts: jobs },
    );
  }
}

/**
 * Validate a manager's create/edit payload and refuse clashes with the person's other leave,
 * or with jobs they are on unless the manager acknowledged them.
 */
async function resolveLeaveInput(tx: Prisma.TransactionClient, body: unknown, excludeLeaveId?: number) {
  const parsed = leaveSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid input", { errors: sanitizeZodErrors(parsed.error) });
  const input = parsed.data;
  const from = input.from_date;
  const to = input.to_date || input.from_date;
  checkLength(from, to);

  const person = await tx.user.findUnique({ where: { id: input.user_id }, select: { id: true, name: true, role: true, is_active: true } });
  if (!person || !isFieldRole(person.role)) throw new HttpError(400, "Leave is recorded for Pasters, Helpers and Drivers only.");
  if (!person.is_active) throw new HttpError(400, `${person.name} is deactivated.`);

  await lockPeople(tx, [person.id]);
  await checkOwnLeave(tx, person, from, to, excludeLeaveId);
  if (!input.acknowledge_jobs) await refuseJobClashes(tx, person, from, to, "save");

  return { person, from, to, reason: input.reason || null };
}

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

export const listLeave = async (req: Request, res: Response) => {
  try {
    const today = todayIST();
    const from = dayQuery.safeParse(req.query.from).success ? String(req.query.from) : addDays(today, -30);
    const to = dayQuery.safeParse(req.query.to).success ? String(req.query.to) : addDays(today, 60);
    const statuses = req.query.status ? (String(req.query.status).split(",").filter(Boolean) as LeaveStatus[]) : null;
    // Requests waiting for a decision are listed whatever their dates, so none is missed.
    const pendingOnly = statuses?.length === 1 && statuses[0] === "PENDING";
    const where: Prisma.LeaveRecordWhereInput = pendingOnly ? {} : { from_date: { lte: parseDay(to) }, to_date: { gte: parseDay(from) } };
    if (req.query.user_id) where.user_id = parseId(req.query.user_id);
    if (statuses) where.status = { in: statuses };
    if (req.query.include_cancelled !== "1") {
      where.cancelled_at = null;
      if (!statuses) where.status = { not: "REJECTED" };
    }
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
        data: {
          user_id: r.person.id,
          from_date: parseDay(r.from),
          to_date: parseDay(r.to),
          reason: r.reason,
          status: "APPROVED",
          decided_by: req.user!.id,
          decided_at: new Date(),
          created_by: req.user!.id,
        },
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
      await lockRows(tx, "LeaveRecord", [id]);
      const current = await tx.leaveRecord.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Leave record not found");
      if (current.cancelled_at) throw new HttpError(400, "Cancelled leave cannot be edited. Record new leave instead.");
      if (current.status === "REJECTED") throw new HttpError(400, "Rejected leave cannot be edited. Record new leave instead.");
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

/** Approve or reject a field-staff member's request. */
export const decideLeave = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const parsed = leaveDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const { status, reason, acknowledge_jobs } = parsed.data;
    const leave = await withAudit(req.user!.id, async (tx) => {
      await lockRows(tx, "LeaveRecord", [id]);
      const current = await tx.leaveRecord.findUnique({ where: { id }, include: { user: { select: { id: true, name: true } } } });
      if (!current) throw new HttpError(404, "Leave request not found");
      if (current.cancelled_at) throw new HttpError(400, "This request was withdrawn. Reload to see the latest.");
      if (current.status !== "PENDING") throw new HttpError(400, `This request has already been ${current.status.toLowerCase()}. Reload to see the latest.`);
      if (status === "APPROVED") {
        await lockPeople(tx, [current.user_id]);
        if (!acknowledge_jobs) await refuseJobClashes(tx, current.user, dayKey(current.from_date), dayKey(current.to_date), "approve");
      }
      return tx.leaveRecord.update({
        where: { id },
        data: { status, decided_by: req.user!.id, decided_at: new Date(), reject_reason: status === "REJECTED" ? reason : null },
        include: leaveInclude,
      });
    });
    const s = serializeLeave(leave);
    const range = fmtRange(s.from_date, s.to_date);
    await (status === "APPROVED"
      ? notifyUser(leave.user_id, "Leave approved", `${range} is approved.`, "success", null)
      : notifyUser(leave.user_id, "Leave not approved", `${range}. Reason: ${reason}`, "warning", null)
    ).catch(() => {});
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
      await lockRows(tx, "LeaveRecord", [id]);
      const current = await tx.leaveRecord.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Leave record not found");
      if (current.cancelled_at) throw new HttpError(400, "This leave is already cancelled.");
      if (current.status === "REJECTED") throw new HttpError(400, "Rejected leave has nothing to cancel.");
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
        return {
          id: s.id,
          from_date: s.from_date,
          to_date: s.to_date,
          days: s.days,
          reason: s.reason,
          status: s.status,
          state: s.state,
          reject_reason: s.reject_reason,
        };
      }),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/** A field-staff member asks for leave. It waits for the Operation Manager's or Admin's decision. */
export const requestMyLeave = async (req: Request, res: Response) => {
  try {
    const parsed = leaveRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const from = parsed.data.from_date;
    const to = parsed.data.to_date || from;
    if (from < todayIST()) return res.status(400).json({ message: "Leave can be asked for from today onwards." });
    checkLength(from, to);

    const me = req.user!;
    const leave = await withAudit(me.id, async (tx) => {
      const person = await tx.user.findUnique({ where: { id: me.id }, select: { id: true, name: true } });
      if (!person) throw new HttpError(404, "Your account was not found.");
      await lockPeople(tx, [person.id]);
      await checkOwnLeave(tx, person, from, to, undefined, true);
      return tx.leaveRecord.create({
        data: { user_id: person.id, from_date: parseDay(from), to_date: parseDay(to), reason: parsed.data.reason, status: "PENDING", created_by: person.id },
        include: leaveInclude,
      });
    });
    const s = serializeLeave(leave);
    await notifyLeaveDeciders("Leave request", `${leave.user.name}: ${fmtRange(s.from_date, s.to_date)} · ${s.reason}`);
    return res.status(201).json(s);
  } catch (err) {
    return sendError(res, err);
  }
};

/** Withdraw one's own request while it is still waiting. Approved leave is cancelled by a manager. */
export const withdrawMyLeave = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const me = req.user!;
    const leave = await withAudit(me.id, async (tx) => {
      await lockRows(tx, "LeaveRecord", [id]);
      const current = await tx.leaveRecord.findUnique({ where: { id } });
      if (!current || current.user_id !== me.id) throw new HttpError(404, "Leave request not found");
      if (current.cancelled_at) throw new HttpError(400, "This request is already withdrawn.");
      if (current.status !== "PENDING") {
        throw new HttpError(400, current.status === "APPROVED" ? "This leave is approved. Ask the Operations Manager to cancel it." : "This request was not approved, so there is nothing to withdraw.");
      }
      return tx.leaveRecord.update({
        where: { id },
        data: { cancelled_at: new Date(), cancelled_by: me.id, cancel_reason: "Withdrawn by the person" },
        include: leaveInclude,
      });
    });
    const s = serializeLeave(leave);
    await notifyLeaveDeciders("Leave request withdrawn", `${leave.user.name}: ${fmtRange(s.from_date, s.to_date)}`);
    return res.status(200).json(s);
  } catch (err) {
    return sendError(res, err);
  }
};
