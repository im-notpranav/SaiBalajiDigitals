import { apiFetch } from "./client";
import { addDays, type WorkJobStatus } from "./allocation";

/** The Zone Board: where the field team is working, area-wise. */

export type ZoneSpan = "day" | "week";
export type Zone = "LOCAL" | "NON_LOCAL" | "NOT_SET";

export interface ZoneJob {
  id: number;
  status: WorkJobStatus;
  start_date: string;
  end_date: string;
  locality: "LOCAL" | "NON_LOCAL" | null;
  work_details: string | null;
  area: { id: number; name: string; district: string | null } | null;
  order: { order_no: string; client_name: string } | null;
  csm: string | null;
  members: { user_id: number; name: string; role: "PASTER" | "HELPER" | "DRIVER" }[];
}

export interface ZoneCount {
  jobs: number;
  people: number;
}

/** `name` null is "Area not set". */
export interface ZoneArea {
  id: number | null;
  name: string | null;
  count: ZoneCount;
  jobs: ZoneJob[];
}

/** `name` null is "District not set". */
export interface ZoneDistrict {
  name: string | null;
  count: ZoneCount;
  areas: ZoneArea[];
}

export interface ZoneBoard {
  date: string;
  span: ZoneSpan;
  from: string;
  to: string;
  total: ZoneCount;
  LOCAL: { count: ZoneCount; areas: ZoneArea[] };
  NON_LOCAL: { count: ZoneCount; districts: ZoneDistrict[] };
  NOT_SET: { count: ZoneCount; areas: ZoneArea[] };
}

export const fetchZoneBoard = (date: string, span: ZoneSpan) =>
  apiFetch<ZoneBoard>(`/zone-board?date=${date}&span=${span}`);

/** The Monday on or before a YYYY-MM-DD date, as on the Weekly Grid. */
export function mondayOf(d: string): string {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((day + 6) % 7));
}
