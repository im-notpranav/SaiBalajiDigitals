import { Request, Response } from "express";
import type { OvertimeStatus, Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { overtimeSchema, overtimeUpdateSchema, overtimeDecisionSchema, dayQuery } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { isFieldRole } from "../utils/roles";
import { notifyUser } from "../services/notifications.service";
import {
  addDays,
  dayKey,
  findLeaveClashes,
  formatMinutes,
  isOvertimeOverlapViolation,
  lockPeople,
  lockRows,
  overtimeSpan,
  parseDay,
  todayIST,
} from "../utils/work-allocation";

/**
 * Overtime register (the old "OT - AS" sheet). The Operation Manager or Admin logs each
 * stretch of extra work per person; hours come from the start and close times, running
 * past midnight when the close is earlier. Only an Admin approves or rejects. Entries can
 * be changed or deleted only while still pending.
 */

class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

function sendError(res: Response, err: any) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.body });
  if (isOvertimeOverlapViolation(err)) {
    return res.status(409).json({ message: "This person already has overtime logged for part of that time. Reload and try again." });
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

const otInclude = {
  user: { select: { id: true, name: true, role: true, emp_code: true } },
  workJob: { select: { id: true, work_details: true, order: { select: { order_no: true } } } },
  csmCode: { select: { id: true, code: true } },
  creator: { select: { id: true, name: true } },
  decider: { select: { id: true, name: true } },
} satisfies Prisma.OvertimeEntryInclude;

type OtRow = Prisma.OvertimeEntryGetPayload<{ include: typeof otInclude }>;

export function serializeOvertime(o: OtRow) {
  return {
    id: o.id,
    user: o.user,
    work_date: dayKey(o.work_date),
    start_time: o.start_time,
    end_time: o.end_time,
    minutes: o.minutes,
    hours: Math.round((o.minutes / 60) * 100) / 100,
    duration: formatMinutes(o.minutes),
    past_midnight: o.end_time <= o.start_time,
    work_job: o.workJob,
    csm_code: o.csmCode,
    remarks: o.remarks,
    status: o.status,
    creator: o.creator,
    decider: o.decider,
    decided_at: o.decided_at,
    reject_reason: o.reject_reason,
    created_at: o.created_at,
  };
}

const fmtDay = (d: string) => parseDay(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

interface OtInput {
  work_date: string;
  start_time: string;
  end_time: string;
  work_job_id?: number | null;
  csm_code_id?: number | null;
  remarks?: string | null;
}

/**
 * Check one set of times against the people it is for. Returns each person's span; throws
 * an HttpError a manager can act on.
 */
async function resolveOvertime(tx: Prisma.TransactionClient, input: OtInput, userIds: number[], excludeId?: number) {
  const span = overtimeSpan(input.work_date, input.start_time, input.end_time);

  const people = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, role: true, is_active: true } });
  if (people.length !== userIds.length) throw new HttpError(400, "One of the chosen people does not exist.");
  const notField = people.filter((p) => !isFieldRole(p.role));
  if (notField.length) throw new HttpError(400, `${notField.map((p) => p.name).join(", ")} is not a Paster, Helper or Driver.`);
  const inactive = people.filter((p) => !p.is_active);
  if (inactive.length) throw new HttpError(400, `${inactive.map((p) => p.name).join(", ")} is deactivated.`);

  let csmCodeId = input.csm_code_id ?? null;
  if (input.work_job_id) {
    const job = await tx.workJob.findUnique({ where: { id: input.work_job_id }, include: { members: { select: { user_id: true } }, order: { select: { order_no: true } } } });
    if (!job || job.status === "CANCELLED") throw new HttpError(400, "Pick a job that is not cancelled.");
    const onJob = new Set(job.members.map((m) => m.user_id));
    const notOnJob = people.filter((p) => !onJob.has(p.id));
    if (notOnJob.length) throw new HttpError(400, `${notOnJob.map((p) => p.name).join(", ")} is not on the job${job.order ? ` for ${job.order.order_no}` : ""}.`);
    csmCodeId = csmCodeId ?? job.csm_code_id;
  }
  if (csmCodeId) {
    const code = await tx.csmCode.findUnique({ where: { id: csmCodeId } });
    if (!code) throw new HttpError(400, "That CSM code does not exist.");
  }

  await lockPeople(tx, userIds);

  const onLeave = await findLeaveClashes(tx, { userIds, start: input.work_date, end: input.work_date });
  if (onLeave.length) {
    throw new HttpError(409, `${[...new Set(onLeave.map((l) => l.name))].join(", ")} ${onLeave.length === 1 ? "is" : "are"} on leave on ${fmtDay(input.work_date)}.`, {
      leave_conflicts: onLeave,
    });
  }

  // Readable overlap check; the exclusion constraint backs it up.
  const nearby = await tx.overtimeEntry.findMany({
    where: {
      user_id: { in: userIds },
      status: { not: "REJECTED" },
      work_date: { gte: parseDay(addDays(input.work_date, -1)), lte: parseDay(addDays(input.work_date, 1)) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    include: { user: { select: { name: true } } },
  });
  const clashes = nearby.filter((o) => o.start_minute < span.start_minute + span.minutes && o.start_minute + o.minutes > span.start_minute);
  if (clashes.length) {
    const c = clashes[0];
    throw new HttpError(409, `${c.user.name} already has overtime on ${fmtDay(dayKey(c.work_date))}, ${c.start_time}–${c.end_time}, overlapping these times.`, {
      overtime_conflicts: clashes.map((o) => ({ id: o.id, user_id: o.user_id, name: o.user.name, work_date: dayKey(o.work_date), start_time: o.start_time, end_time: o.end_time })),
    });
  }

  return {
    data: {
      work_date: parseDay(input.work_date),
      start_time: input.start_time,
      end_time: input.end_time,
      minutes: span.minutes,
      start_minute: span.start_minute,
      work_job_id: input.work_job_id ?? null,
      csm_code_id: csmCodeId,
      remarks: input.remarks || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

export const listOvertime = async (req: Request, res: Response) => {
  try {
    const today = todayIST();
    const from = dayQuery.safeParse(req.query.from).success ? String(req.query.from) : addDays(today, -30);
    const to = dayQuery.safeParse(req.query.to).success ? String(req.query.to) : today;
    const where: Prisma.OvertimeEntryWhereInput = { work_date: { gte: parseDay(from), lte: parseDay(to) } };
    if (req.query.user_id) where.user_id = parseId(req.query.user_id);
    if (req.query.status) where.status = { in: String(req.query.status).split(",").filter(Boolean) as OvertimeStatus[] };
    const rows = await prisma.overtimeEntry.findMany({
      where,
      include: otInclude,
      orderBy: [{ work_date: "desc" }, { start_time: "asc" }, { id: "asc" }],
      take: 1000,
    });
    const sum = (s?: OvertimeStatus) => rows.filter((r) => !s || r.status === s).reduce((n, r) => n + r.minutes, 0);
    return res.status(200).json({
      from,
      to,
      totals: {
        entries: rows.length,
        pending: rows.filter((r) => r.status === "PENDING").length,
        approved_minutes: sum("APPROVED"),
        pending_minutes: sum("PENDING"),
      },
      entries: rows.map(serializeOvertime),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

export const createOvertime = async (req: Request, res: Response) => {
  try {
    const parsed = overtimeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const entries = await withAudit(req.user!.id, async (tx) => {
      const r = await resolveOvertime(tx, parsed.data, parsed.data.user_ids);
      const created: OtRow[] = [];
      for (const user_id of parsed.data.user_ids) {
        created.push(await tx.overtimeEntry.create({ data: { ...r.data, user_id, created_by: req.user!.id }, include: otInclude }));
      }
      return created;
    });
    return res.status(201).json({ entries: entries.map(serializeOvertime) });
  } catch (err) {
    return sendError(res, err);
  }
};

export const updateOvertime = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    const parsed = overtimeUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const entry = await withAudit(req.user!.id, async (tx) => {
      await lockRows(tx, "OvertimeEntry", [id]);
      const current = await tx.overtimeEntry.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Overtime entry not found");
      if (current.status !== "PENDING") throw new HttpError(400, `An ${current.status.toLowerCase()} entry cannot be changed.`);
      const r = await resolveOvertime(tx, parsed.data, [parsed.data.user_id], id);
      return tx.overtimeEntry.update({ where: { id }, data: { ...r.data, user_id: parsed.data.user_id }, include: otInclude });
    });
    return res.status(200).json(serializeOvertime(entry));
  } catch (err) {
    return sendError(res, err);
  }
};

export const deleteOvertime = async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id);
    await withAudit(req.user!.id, async (tx) => {
      await lockRows(tx, "OvertimeEntry", [id]);
      const current = await tx.overtimeEntry.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Overtime entry not found");
      if (current.status !== "PENDING") throw new HttpError(400, `An ${current.status.toLowerCase()} entry cannot be deleted.`);
      await tx.overtimeEntry.delete({ where: { id } });
    });
    return res.status(200).json({ message: "Overtime entry deleted" });
  } catch (err) {
    return sendError(res, err);
  }
};

/** Admin approves or rejects pending entries, one or many at a time. */
export const decideOvertime = async (req: Request, res: Response) => {
  try {
    const parsed = overtimeDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const { ids, status, reason } = parsed.data;
    const entries = await withAudit(req.user!.id, async (tx) => {
      await lockRows(tx, "OvertimeEntry", ids);
      const rows = await tx.overtimeEntry.findMany({ where: { id: { in: ids } } });
      if (rows.length !== new Set(ids).size) throw new HttpError(404, "Some of these entries no longer exist. Reload and try again.");
      const decided = rows.filter((r) => r.status !== "PENDING");
      if (decided.length) throw new HttpError(400, `${decided.length} of these entries ${decided.length === 1 ? "has" : "have"} already been decided. Reload and try again.`);
      await tx.overtimeEntry.updateMany({
        where: { id: { in: ids } },
        data: { status, decided_by: req.user!.id, decided_at: new Date(), reject_reason: status === "REJECTED" ? reason : null },
      });
      return tx.overtimeEntry.findMany({ where: { id: { in: ids } }, include: otInclude });
    });
    await Promise.all(
      entries.map((o) =>
        notifyUser(
          o.user_id,
          status === "APPROVED" ? "Overtime approved" : "Overtime rejected",
          `${fmtDay(dayKey(o.work_date))}, ${o.start_time}–${o.end_time} (${formatMinutes(o.minutes)})${status === "REJECTED" ? `. Reason: ${reason}` : ""}`,
          status === "APPROVED" ? "success" : "warning",
          null,
        ).catch(() => {}),
      ),
    );
    return res.status(200).json({ entries: entries.map(serializeOvertime) });
  } catch (err) {
    return sendError(res, err);
  }
};

// ---------------------------------------------------------------------------
// Field staff: their own overtime
// ---------------------------------------------------------------------------

export const myOvertime = async (req: Request, res: Response) => {
  try {
    const today = todayIST();
    const monthStart = `${today.slice(0, 7)}-01`;
    const rows = await prisma.overtimeEntry.findMany({
      where: { user_id: req.user!.id, work_date: { gte: parseDay(addDays(today, -60)) } },
      include: otInclude,
      orderBy: [{ work_date: "desc" }, { start_time: "asc" }],
    });
    const thisMonth = rows.filter((r) => dayKey(r.work_date) >= monthStart);
    return res.status(200).json({
      month: today.slice(0, 7),
      month_approved_minutes: thisMonth.filter((r) => r.status === "APPROVED").reduce((n, r) => n + r.minutes, 0),
      month_pending_minutes: thisMonth.filter((r) => r.status === "PENDING").reduce((n, r) => n + r.minutes, 0),
      entries: rows.map((o) => {
        const s = serializeOvertime(o);
        return {
          id: s.id,
          work_date: s.work_date,
          start_time: s.start_time,
          end_time: s.end_time,
          minutes: s.minutes,
          duration: s.duration,
          past_midnight: s.past_midnight,
          order_no: s.work_job?.order?.order_no ?? null,
          remarks: s.remarks,
          status: s.status,
          reject_reason: s.reject_reason,
        };
      }),
    });
  } catch (err) {
    return sendError(res, err);
  }
};
