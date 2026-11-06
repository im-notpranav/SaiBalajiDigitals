/**
 * Rules for field work jobs, kept in one place so the controllers, the board and the grid
 * all apply the same ones. Everything here is pure except findConflicts, which reads.
 */
import type { WorkJobStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Days. Jobs are whole days in India time, stored as DATE and passed as "YYYY-MM-DD".
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** "2026-10-21" → that date at 00:00 UTC, which is what Prisma reads and writes for DATE. */
export const parseDay = (key: string): Date => new Date(`${key}T00:00:00.000Z`);
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (key: string, n: number): string => dayKey(new Date(parseDay(key).getTime() + n * DAY_MS));
export const todayIST = (): string => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number =>
  Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);

// ---------------------------------------------------------------------------
// Team and lifecycle
// ---------------------------------------------------------------------------

/** Most people of each role one job can take: the old Task Log had 2 / 2 / 1 columns. */
export const TEAM_LIMITS = { PASTER: 2, HELPER: 2, DRIVER: 1 } as const;
export type SlotRole = keyof typeof TEAM_LIMITS;

/** Longest a single job may run. Longer work is split into jobs, as in the old sheets. */
export const MAX_JOB_DAYS = 62;

/** Which status changes are allowed. Completed can be reopened; cancelled is final. */
export const STATUS_TRANSITIONS: Record<WorkJobStatus, WorkJobStatus[]> = {
  ASSIGNED: ["STARTED", "HOLD", "CANCELLED"],
  STARTED: ["COMPLETED", "HOLD", "CANCELLED"],
  HOLD: ["ASSIGNED", "STARTED", "CANCELLED"],
  COMPLETED: ["STARTED"],
  CANCELLED: [],
};

/** Statuses in which the job's details and team can still be changed. */
export const EDITABLE_STATUSES: WorkJobStatus[] = ["ASSIGNED", "STARTED", "HOLD"];

/** Whether a job's people are booked: a cancelled job frees them, "Allow 2nd job" overlaps. */
export const blocksCalendar = (job: { status: WorkJobStatus; allow_double_booking: boolean }) =>
  job.status !== "CANCELLED" && !job.allow_double_booking;

/** Count each role in a team and report any role over its limit, or a missing Paster or Driver. */
export function teamLimitErrors(roles: string[]): string[] {
  const errors: string[] = [];
  for (const [role, max] of Object.entries(TEAM_LIMITS)) {
    const n = roles.filter((r) => r === role).length;
    if (n > max) errors.push(`A job can have at most ${max} ${role.toLowerCase()}${max === 1 ? "" : "s"} (got ${n}).`);
  }
  if (!roles.includes("PASTER")) errors.push("Pick a Paster.");
  if (!roles.includes("DRIVER")) errors.push("Pick a Driver.");
  return errors;
}

/** " on ORD260123", or nothing for a job with no order yet: "New job on ORD260123". */
export const onOrder = (job: { order?: { order_no: string } | null }) => (job.order ? ` on ${job.order.order_no}` : "");

/** Where a job is, in words: its area, else Hyderabad or Non-local, else null. */
export function jobPlace(job: { area?: { name: string } | null; locality?: string | null }): string | null {
  if (job.area) return job.area.name;
  if (job.locality) return job.locality === "LOCAL" ? "Hyderabad" : "Non-local";
  return null;
}

// ---------------------------------------------------------------------------
// Grid label: how a job appears in a person's day cell, as on the old WAS grid.
// "600" · "088/NSG" (two CSMs) · "600-N" (non-local) · "600-N_CN" (non-local + tag)
// ---------------------------------------------------------------------------

export function gridLabel(job: {
  csmCode?: { code: string } | null;
  csm2Code?: { code: string } | null;
  order?: { order_no: string } | null;
  locality: string | null;
  extra_tag?: string | null;
}): string {
  let label = job.csmCode?.code ?? job.order?.order_no ?? "Job";
  if (job.csm2Code) label += `/${job.csm2Code.code}`;
  if (job.locality === "NON_LOCAL") label += "-N" + (job.extra_tag ? `_${job.extra_tag}` : "");
  else if (job.extra_tag) label += `-${job.extra_tag}`;
  return label;
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export interface Conflict {
  user_id: number;
  name: string;
  job_id: number;
  order_no: string | null;
  work_details: string | null;
  start_date: string;
  end_date: string;
}

/**
 * People in `userIds` who are already booked on another job overlapping [start, end].
 * Only bookings that block the calendar count, matching the database constraint.
 */
export async function findConflicts(
  tx: any,
  opts: { userIds: number[]; start: string; end: string; excludeJobId?: number },
): Promise<Conflict[]> {
  if (opts.userIds.length === 0) return [];
  const rows = await tx.workJobMember.findMany({
    where: {
      user_id: { in: opts.userIds },
      blocks_calendar: true,
      start_date: { lte: parseDay(opts.end) },
      end_date: { gte: parseDay(opts.start) },
      ...(opts.excludeJobId ? { job_id: { not: opts.excludeJobId } } : {}),
    },
    include: {
      user: { select: { name: true } },
      job: { select: { id: true, work_details: true, start_date: true, end_date: true, order: { select: { order_no: true } } } },
    },
    orderBy: { start_date: "asc" },
  });
  return rows.map((r: any) => ({
    user_id: r.user_id,
    name: r.user.name,
    job_id: r.job.id,
    order_no: r.job.order?.order_no ?? null,
    work_details: r.job.work_details,
    start_date: dayKey(r.job.start_date),
    end_date: dayKey(r.job.end_date),
  }));
}

/** Postgres raises 23P01 when the no-overlap exclusion constraint rejects a booking. */
export const isOverlapViolation = (err: any): boolean =>
  /23P01|WorkJobMember_no_overlap|exclusion constraint/i.test(String(err?.message ?? "") + String(err?.meta?.code ?? ""));

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export interface LeaveClash {
  user_id: number;
  name: string;
  leave_id: number;
  from_date: string;
  to_date: string;
  reason: string | null;
}

/**
 * People in `userIds` with approved, not cancelled leave overlapping [start, end]. With
 * `includePending`, requests still waiting for a decision count too: they hold the days
 * against other leave, but do not block jobs or overtime until approved.
 */
export async function findLeaveClashes(
  tx: any,
  opts: { userIds: number[]; start: string; end: string; excludeLeaveId?: number; includePending?: boolean },
): Promise<LeaveClash[]> {
  if (opts.userIds.length === 0) return [];
  const rows = await tx.leaveRecord.findMany({
    where: {
      user_id: { in: opts.userIds },
      cancelled_at: null,
      status: opts.includePending ? { not: "REJECTED" } : "APPROVED",
      from_date: { lte: parseDay(opts.end) },
      to_date: { gte: parseDay(opts.start) },
      ...(opts.excludeLeaveId ? { id: { not: opts.excludeLeaveId } } : {}),
    },
    include: { user: { select: { name: true } } },
    orderBy: { from_date: "asc" },
  });
  return rows.map((r: any) => ({
    user_id: r.user_id,
    name: r.user.name,
    leave_id: r.id,
    from_date: dayKey(r.from_date),
    to_date: dayKey(r.to_date),
    reason: r.reason,
  }));
}

/**
 * Serialise writes that book or free the same people (jobs, leave, overtime) until the
 * transaction ends. Jobs-vs-jobs and leave-vs-leave also have exclusion constraints, but
 * jobs-vs-leave spans two tables, so two managers saving at once must queue here. Ids
 * are locked in order so two transactions can never deadlock on each other.
 */
const PERSON_LOCK_NS = 7301;
export async function lockPeople(tx: any, userIds: number[]): Promise<void> {
  for (const id of [...new Set(userIds)].sort((a, b) => a - b)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PERSON_LOCK_NS}::int, ${id}::int)`;
  }
}

/**
 * Row locks for read-check-write on a job, leave record or overtime entry. Taken before the
 * row is read, so of two people acting at once the second waits, then reads what the first
 * saved and gets the "already decided / cannot be moved" answer instead of overwriting it
 * (GAP-E01). Ids are locked in order so two multi-row callers cannot deadlock.
 */
export async function lockRows(tx: any, table: "WorkJob" | "LeaveRecord" | "OvertimeEntry", ids: number[]): Promise<void> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  if (!unique.length) return;
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, unique);
}

export const isLeaveOverlapViolation = (err: any): boolean =>
  /LeaveRecord_no_overlap/i.test(String(err?.message ?? "") + String(err?.meta?.message ?? ""));

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------

const clockMinutes = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Length of a stretch of overtime, and where it starts on one continuous minute line.
 * A close time at or before the start means the work ran past midnight (the old sheet's
 * MOD(close − start, 1) × 24).
 */
export function overtimeSpan(workDate: string, start: string, end: string) {
  const s = clockMinutes(start);
  const e = clockMinutes(end);
  const minutes = e > s ? e - s : e - s + 1440;
  const start_minute = Math.round(parseDay(workDate).getTime() / 60_000) + s;
  return { minutes, start_minute, past_midnight: e <= s };
}

/** 390 → "6h 30m". */
export const formatMinutes = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const isOvertimeOverlapViolation = (err: any): boolean =>
  /OvertimeEntry_no_overlap/i.test(String(err?.message ?? "") + String(err?.meta?.message ?? ""));
