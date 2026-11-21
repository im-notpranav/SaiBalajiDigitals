import { apiFetch } from "./client";

export interface Machine {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
  operator_count?: number;
  media_count?: number;
}

/** One order line as the machine queue and the board show it. */
export interface MachineLine {
  id: number;
  s_no: number;
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  total_sft: number;
  machine_id: number | null;
  started_at: string | null;
  started_by: number | null;
  returned_reason: string | null;
  returned_at: string | null;
  is_flagged: boolean;
  production_completed: boolean;
  orderStore: { s_no: number; store_name: string; location: string } | null;
  order: { id: number; order_no: string; client_name: string; date: string; created_by: number | null; creator_name: string };
  assignments: { user_id: number; completed: boolean; assigned_at: string; user: { id: number; name: string } }[];
}

export interface MachineSetup {
  machines: Machine[];
  media: { id: number; name: string; is_active: boolean; default_machine_id: number | null }[];
  operators: { id: number; name: string; username: string; is_active: boolean; machine_id: number | null }[];
}

export interface MachineBoardData {
  machines: Machine[];
  operators: { id: number; name: string; machine_id: number | null }[];
  lines: MachineLine[];
  completed_today: number;
}

export const fetchMachines = () => apiFetch<{ machines: Machine[] }>("/machines");
export const fetchMachineSetup = () => apiFetch<MachineSetup>("/machines/setup");
export const createMachine = (name: string) => apiFetch<{ machine: Machine }>("/machines", { method: "POST", data: { name } });
export const updateMachine = (id: number, data: { name?: string; is_active?: boolean; sort_order?: number }) =>
  apiFetch<{ machine: Machine }>(`/machines/${id}`, { method: "PATCH", data });
export const setMediaMachine = (mediaId: number, machine_id: number | null) =>
  apiFetch(`/machines/media/${mediaId}`, { method: "PUT", data: { machine_id } });
export const setOperatorMachine = (userId: number, machine_id: number | null) =>
  apiFetch(`/machines/operators/${userId}`, { method: "PUT", data: { machine_id } });

export const fetchMyMachineQueue = () => apiFetch<{ machine: Machine | null; lines: MachineLine[] }>("/production/machine-queue");
export const startLine = (id: number) => apiFetch<{ ok: true; taken: boolean }>(`/production/lines/${id}/start`, { method: "POST" });
export const rejectLine = (id: number, reason: string) =>
  apiFetch<{ ok: true }>(`/production/lines/${id}/reject`, { method: "POST", data: { reason } });
export const fetchMachineBoard = () => apiFetch<MachineBoardData>("/production/board");
export const changeLineMachine = (id: number, machine_id: number | null) =>
  apiFetch<{ line: MachineLine }>(`/production/lines/${id}/machine`, { method: "PATCH", data: { machine_id } });

/** Whole days since the order date: the line's age on the floor. */
export const ageDays = (date: string) => Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
/** 0–5 days green, 6–10 orange, 11+ red. */
export const ageTone = (days: number) =>
  days <= 5
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : days <= 10
      ? "bg-orange-500/15 text-orange-700 dark:text-orange-300"
      : "bg-red-500/15 text-red-700 dark:text-red-300";
export const lineSize = (l: Pick<MachineLine, "width_inches" | "height_inches" | "qty">) =>
  `${Number(l.width_inches)}×${Number(l.height_inches)} ×${Number(l.qty)}`;
