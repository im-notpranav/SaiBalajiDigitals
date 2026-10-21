import { apiFetch } from "./client";

/** Client for the work-allocation portal: field staff and the allocation masters. */

export type FieldRole = "PASTER" | "HELPER" | "DRIVER";
export type AreaLocality = "LOCAL" | "NON_LOCAL";
export type CsmCodeKind = "CSM" | "TEAM" | "BRANCH" | "UNKNOWN";

export interface FieldStaff {
  id: number;
  name: string;
  username: string;
  role: FieldRole;
  phone: string | null;
  emp_code: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Area {
  id: number;
  name: string;
  locality: AreaLocality;
  district: string | null;
  needs_confirmation: boolean;
  is_active: boolean;
}

export interface Vehicle {
  id: number;
  reg_no: string;
  type: string;
  usual_driver_id: number | null;
  usualDriver: { id: number; name: string } | null;
  notes: string | null;
  is_active: boolean;
}

export interface CsmCode {
  id: number;
  code: string;
  kind: CsmCodeKind;
  label: string | null;
  user_id: number | null;
  user: { id: number; name: string; username: string } | null;
  is_active: boolean;
}

export const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  PASTER: "Paster",
  HELPER: "Helper",
  DRIVER: "Driver",
};

export const LOCALITY_LABELS: Record<AreaLocality, string> = {
  LOCAL: "Local",
  NON_LOCAL: "Non-local",
};

export const CSM_CODE_KIND_LABELS: Record<CsmCodeKind, string> = {
  CSM: "CSM",
  TEAM: "Team",
  BRANCH: "Branch",
  UNKNOWN: "Not confirmed",
};

// --- Field staff -----------------------------------------------------------

export const fetchFieldStaff = () => apiFetch<{ staff: FieldStaff[] }>("/field-staff");

export const createFieldStaff = (data: {
  name: string;
  username: string;
  password: string;
  role: FieldRole;
  phone?: string | null;
  emp_code?: string | null;
}) => apiFetch<FieldStaff>("/field-staff", { method: "POST", data });

export const updateFieldStaff = (
  id: number,
  data: { name?: string; role?: FieldRole; phone?: string | null; emp_code?: string | null },
) => apiFetch<FieldStaff>(`/field-staff/${id}`, { method: "PATCH", data });

export const setFieldStaffStatus = (id: number, is_active: boolean) =>
  apiFetch<FieldStaff>(`/field-staff/${id}/status`, { method: "PUT", data: { is_active } });

export const resetFieldStaffPassword = (id: number, new_password: string) =>
  apiFetch<{ message: string }>(`/field-staff/${id}/password`, {
    method: "PUT",
    data: { new_password },
  });

// --- Masters ---------------------------------------------------------------

export const fetchAreas = () => apiFetch<{ areas: Area[] }>("/masters/areas");
export const createArea = (data: Partial<Area>) =>
  apiFetch<Area>("/masters/areas", { method: "POST", data });
export const updateArea = (id: number, data: Partial<Area>) =>
  apiFetch<Area>(`/masters/areas/${id}`, { method: "PATCH", data });

export const fetchVehicles = () => apiFetch<{ vehicles: Vehicle[] }>("/masters/vehicles");
export const createVehicle = (data: Partial<Vehicle>) =>
  apiFetch<Vehicle>("/masters/vehicles", { method: "POST", data });
export const updateVehicle = (id: number, data: Partial<Vehicle>) =>
  apiFetch<Vehicle>(`/masters/vehicles/${id}`, { method: "PATCH", data });

export const fetchCsmCodes = () => apiFetch<{ codes: CsmCode[] }>("/masters/csm-codes");
export const createCsmCode = (data: Partial<CsmCode>) =>
  apiFetch<CsmCode>("/masters/csm-codes", { method: "POST", data });
export const updateCsmCode = (id: number, data: Partial<CsmCode>) =>
  apiFetch<CsmCode>(`/masters/csm-codes/${id}`, { method: "PATCH", data });

/** The API answers validation failures as { message, errors: ["field: problem"] }. */
export function apiErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  if (Array.isArray(data?.errors) && data.errors.length) return data.errors.join(", ");
  return data?.message || fallback;
}

// --- Work jobs -------------------------------------------------------------

export type WorkJobStatus = "ASSIGNED" | "STARTED" | "COMPLETED" | "HOLD" | "CANCELLED";

export const JOB_STATUS_LABELS: Record<WorkJobStatus, string> = {
  ASSIGNED: "Assigned",
  STARTED: "Started",
  COMPLETED: "Completed",
  HOLD: "On hold",
  CANCELLED: "Cancelled",
};

/** Mirrors STATUS_TRANSITIONS in the API (utils/work-allocation.ts). */
export const JOB_STATUS_NEXT: Record<WorkJobStatus, WorkJobStatus[]> = {
  ASSIGNED: ["STARTED", "HOLD", "CANCELLED"],
  STARTED: ["COMPLETED", "HOLD", "CANCELLED"],
  HOLD: ["ASSIGNED", "STARTED", "CANCELLED"],
  COMPLETED: ["STARTED"],
  CANCELLED: [],
};

export const JOB_EDITABLE: WorkJobStatus[] = ["ASSIGNED", "STARTED", "HOLD"];

export interface JobStore {
  id: number;
  s_no: number;
  store_name: string;
  location: string | null;
}
interface CodeRef {
  id: number;
  code: string;
  kind: CsmCodeKind;
  label: string | null;
  user: { id: number; name: string } | null;
}

export interface WorkJob {
  id: number;
  status: WorkJobStatus;
  start_date: string;
  end_date: string;
  days: number;
  work_details: string;
  locality: AreaLocality;
  route: string | null;
  extra_tag: string | null;
  instructions: string | null;
  allow_double_booking: boolean;
  label: string;
  order: {
    id: number;
    order_no: string;
    client_name: string;
    status: string;
    created_by: number | null;
    creator_name: string | null;
  };
  area: { id: number; name: string; locality: AreaLocality };
  vehicle: { id: number; reg_no: string; type: string } | null;
  csm_code: CodeRef | null;
  csm2_code: CodeRef | null;
  creator: { id: number; name: string } | null;
  members: { user_id: number; name: string; phone: string | null; slot_role: FieldRole }[];
  stores: JobStore[];
  started_at: string | null;
  started_by: { id: number; name: string } | null;
  completed_at: string | null;
  completed_by: { id: number; name: string } | null;
  completion_note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobConflict {
  user_id: number;
  name: string;
  job_id: number;
  /** A job goes by its order's number. */
  order_no: string;
  work_details: string;
  start_date: string;
  end_date: string;
}

export interface WorkJobInput {
  order_id: number;
  store_ids: number[];
  start_date: string;
  end_date?: string;
  csm_code_id?: number | null;
  csm2_code_id?: number | null;
  work_details: string;
  area_id: number;
  vehicle_id?: number | null;
  route?: string | null;
  extra_tag?: string | null;
  instructions?: string | null;
  allow_double_booking: boolean;
  member_ids: number[];
}

export interface OrderOption {
  id: number;
  order_no: string;
  client_name: string;
  status: string;
  created_by: number | null;
  creator_name: string | null;
  stores: JobStore[];
  csm_code: { id: number; code: string } | null;
}

export interface StaffBrief {
  id: number;
  name: string;
  role: FieldRole;
  phone: string | null;
  emp_code: string | null;
}
type JobRef = { job_id: number; order_no: string; label: string };

export interface DailyBoard {
  date: string;
  counts: {
    jobs: number;
    free_pasters: number;
    free_helpers: number;
    free_drivers: number;
    busy: number;
    double_booked: number;
    on_leave: number;
  };
  free: Record<FieldRole, StaffBrief[]>;
  busy: (StaffBrief & { jobs: JobRef[]; leave: LeaveRef | null })[];
  /** Everyone on leave that day; those with jobs too were booked before the leave. */
  on_leave: (StaffBrief & { jobs: JobRef[]; leave: LeaveRef })[];
  jobs: WorkJob[];
}

type LeaveRef = { id: number; from_date: string; to_date: string; reason: string | null };

export interface WeeklyGrid {
  from: string;
  to: string;
  dates: string[];
  rows: (StaffBrief & { days: (JobRef & { status: WorkJobStatus })[][]; leave: boolean[] })[];
  free: Record<FieldRole, number>[];
}

export interface MyJob extends Omit<WorkJob, "order"> {
  order: { order_no: string; client_name: string };
  csm: { id: number; name: string; phone: string | null } | null;
}

export type JobFilters = Partial<
  Record<
    | "from"
    | "to"
    | "status"
    | "user_id"
    | "area_id"
    | "csm_code_id"
    | "locality"
    | "order_id"
    | "q",
    string
  >
>;

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();
  return s ? `?${s}` : "";
};

export const fetchWorkJobs = (filters: JobFilters) =>
  apiFetch<{ from: string; to: string; jobs: WorkJob[] }>(`/work-jobs${qs(filters)}`);
export const fetchWorkJob = (id: number) => apiFetch<WorkJob>(`/work-jobs/${id}`);
export const createWorkJob = (data: WorkJobInput) =>
  apiFetch<WorkJob>("/work-jobs", { method: "POST", data });
export const updateWorkJob = (id: number, data: WorkJobInput) =>
  apiFetch<WorkJob>(`/work-jobs/${id}`, { method: "PUT", data });
export const setWorkJobStatus = (id: number, status: WorkJobStatus, reason?: string) =>
  apiFetch<WorkJob>(`/work-jobs/${id}/status`, { method: "PUT", data: { status, reason } });
export const fetchOrderOptions = (q: string) =>
  apiFetch<{ orders: OrderOption[] }>(`/work-jobs/order-options${qs({ q })}`);
export const fetchDailyBoard = (date?: string) =>
  apiFetch<DailyBoard>(`/work-jobs/board${qs({ date })}`);
export const fetchWeeklyGrid = (from?: string, days = 7) =>
  apiFetch<WeeklyGrid>(`/work-jobs/grid${qs({ from, days: String(days) })}`);
export const fetchMyJobs = () => apiFetch<{ today: string; jobs: MyJob[] }>("/my/work-jobs");
/** Field staff: mark their own job started, or completed with an optional note. */
export const setMyJobStatus = (id: number, status: "STARTED" | "COMPLETED", note?: string) =>
  apiFetch<WorkJob>(`/my/work-jobs/${id}/status`, { method: "PUT", data: { status, note } });

/** Today in India as YYYY-MM-DD, matching the API's todayIST(). */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "21 Oct" or "21 – 23 Oct" for a job's dates; the year is added outside the current year. */
export function formatJobDates(start: string, end: string): string {
  const thisYear = todayIST().slice(0, 4);
  const fmt = (d: string, month = true) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: month ? "short" : undefined,
      year: month && d.slice(0, 4) !== thisYear ? "numeric" : undefined,
      timeZone: "UTC",
    });
  if (start === end) return fmt(start);
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${fmt(start, false)} – ${fmt(end)}`
    : `${fmt(start)} – ${fmt(end)}`;
}

// --- Leave -----------------------------------------------------------------

export type LeaveState = "UPCOMING" | "CURRENT" | "PAST" | "CANCELLED";

export interface LeaveRecord {
  id: number;
  user: {
    id: number;
    name: string;
    role: FieldRole;
    phone: string | null;
    emp_code: string | null;
  };
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  state: LeaveState;
  creator: { id: number; name: string } | null;
  created_at: string;
  cancelled_at: string | null;
  canceller: { id: number; name: string } | null;
  cancel_reason: string | null;
}

export interface LeaveInput {
  user_id: number;
  from_date: string;
  to_date?: string | null;
  reason?: string | null;
  acknowledge_jobs?: boolean;
}

/** A job the person is already on, returned when leave would overlap it. */
export interface LeaveJobClash {
  job_id: number;
  order_no: string;
  work_details: string;
  status: WorkJobStatus;
  start_date: string;
  end_date: string;
}

export interface LeaveClash {
  user_id: number;
  name: string;
  leave_id: number;
  from_date: string;
  to_date: string;
  reason: string | null;
}

export const fetchLeave = (filters: {
  from?: string;
  to?: string;
  user_id?: string;
  include_cancelled?: boolean;
}) =>
  apiFetch<{ from: string; to: string; leave: LeaveRecord[] }>(
    `/leave${qs({ from: filters.from, to: filters.to, user_id: filters.user_id, include_cancelled: filters.include_cancelled ? "1" : undefined })}`,
  );
export const createLeave = (data: LeaveInput) =>
  apiFetch<LeaveRecord>("/leave", { method: "POST", data });
export const updateLeave = (id: number, data: LeaveInput) =>
  apiFetch<LeaveRecord>(`/leave/${id}`, { method: "PUT", data });
export const cancelLeave = (id: number, reason: string) =>
  apiFetch<LeaveRecord>(`/leave/${id}/cancel`, { method: "PUT", data: { reason } });
export const fetchMyLeave = () =>
  apiFetch<{
    today: string;
    leave: Pick<LeaveRecord, "id" | "from_date" | "to_date" | "days" | "reason" | "state">[];
  }>("/my/leave");

// --- Overtime --------------------------------------------------------------

export type OvertimeStatus = "PENDING" | "APPROVED" | "REJECTED";

export const OT_STATUS_LABELS: Record<OvertimeStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export interface OvertimeEntry {
  id: number;
  user: { id: number; name: string; role: FieldRole; emp_code: string | null };
  work_date: string;
  start_time: string;
  end_time: string;
  minutes: number;
  hours: number;
  duration: string;
  past_midnight: boolean;
  work_job: { id: number; work_details: string; order: { order_no: string } } | null;
  csm_code: { id: number; code: string } | null;
  remarks: string | null;
  status: OvertimeStatus;
  creator: { id: number; name: string } | null;
  decider: { id: number; name: string } | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface OvertimeInput {
  work_date: string;
  start_time: string;
  end_time: string;
  work_job_id?: number | null;
  csm_code_id?: number | null;
  remarks?: string | null;
}

export interface MyOvertimeEntry {
  id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  minutes: number;
  duration: string;
  past_midnight: boolean;
  order_no: string | null;
  remarks: string | null;
  status: OvertimeStatus;
  reject_reason: string | null;
}

export const fetchOvertime = (filters: {
  from?: string;
  to?: string;
  user_id?: string;
  status?: string;
}) =>
  apiFetch<{
    from: string;
    to: string;
    totals: { entries: number; pending: number; approved_minutes: number; pending_minutes: number };
    entries: OvertimeEntry[];
  }>(`/overtime${qs(filters)}`);
export const createOvertime = (data: OvertimeInput & { user_ids: number[] }) =>
  apiFetch<{ entries: OvertimeEntry[] }>("/overtime", { method: "POST", data });
export const updateOvertime = (id: number, data: OvertimeInput & { user_id: number }) =>
  apiFetch<OvertimeEntry>(`/overtime/${id}`, { method: "PUT", data });
export const deleteOvertime = (id: number) =>
  apiFetch<{ message: string }>(`/overtime/${id}`, { method: "DELETE" });
export const decideOvertime = (ids: number[], status: "APPROVED" | "REJECTED", reason?: string) =>
  apiFetch<{ entries: OvertimeEntry[] }>("/overtime/decision", {
    method: "PUT",
    data: { ids, status, reason },
  });
export const fetchMyOvertime = () =>
  apiFetch<{
    month: string;
    month_approved_minutes: number;
    month_pending_minutes: number;
    entries: MyOvertimeEntry[];
  }>("/my/overtime");

/** Mirrors overtimeSpan in the API: a close at or before the start runs past midnight. */
export function overtimeMinutes(start: string, end: string): number | null {
  const m = (t: string) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null;
  const s = m(start);
  const e = m(end);
  if (s === null || e === null || s === e) return null;
  return e > s ? e - s : e - s + 1440;
}

/** 390 → "6h 30m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
