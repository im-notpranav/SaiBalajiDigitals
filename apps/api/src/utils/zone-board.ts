/**
 * The Zone Board: where the field team is working, area-wise. Hyderabad jobs are grouped by
 * area; non-local jobs by district, then area. Jobs with no locality yet sit apart under
 * "Not set". Pure, so the grouping and sorting can be unit tested without a database.
 */
import { addDays, parseDay } from "./work-allocation";

export type ZoneSpan = "day" | "week";
type Locality = "LOCAL" | "NON_LOCAL";

/** The Monday on or before a YYYY-MM-DD date: weeks start on Monday, as on the Weekly Grid. */
export function mondayOf(key: string): string {
  const day = parseDay(key).getUTCDay();
  return addDays(key, -((day + 6) % 7));
}

/** One day, or the Monday-to-Sunday week the day falls in. */
export function zoneRange(date: string, span: ZoneSpan): { from: string; to: string } {
  if (span === "day") return { from: date, to: date };
  const from = mondayOf(date);
  return { from, to: addDays(from, 6) };
}

export interface ZoneJob {
  id: number;
  status: string;
  start_date: string;
  end_date: string;
  locality: Locality | null;
  work_details: string | null;
  area: { id: number; name: string; district: string | null } | null;
  order: { order_no: string; client_name: string } | null;
  csm: string | null;
  members: { user_id: number; name: string; role: string }[];
}

export interface ZoneCount {
  jobs: number;
  people: number;
}

/** `name` null is "Area not set" / "District not set". */
export interface ZoneArea {
  id: number | null;
  name: string | null;
  count: ZoneCount;
  jobs: ZoneJob[];
}

export interface ZoneDistrict {
  name: string | null;
  count: ZoneCount;
  areas: ZoneArea[];
}

export interface ZoneGroups {
  total: ZoneCount;
  LOCAL: { count: ZoneCount; areas: ZoneArea[] };
  NON_LOCAL: { count: ZoneCount; districts: ZoneDistrict[] };
  NOT_SET: { count: ZoneCount; areas: ZoneArea[] };
}

const ROLE_ORDER: Record<string, number> = { PASTER: 0, HELPER: 1, DRIVER: 2 };

/** How many jobs, and how many different people are on them (someone on two jobs counts once). */
function countOf(jobs: ZoneJob[]): ZoneCount {
  return { jobs: jobs.length, people: new Set(jobs.flatMap((j) => j.members.map((m) => m.user_id))).size };
}

/** Alphabetical, ignoring case, with the unnamed group ("not set") last. */
function byName(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

/** Earliest start first; on the same day, by order number, jobs with no order last. */
function byStart(a: ZoneJob, b: ZoneJob): number {
  return (
    a.start_date.localeCompare(b.start_date) ||
    byName(a.order?.order_no ?? null, b.order?.order_no ?? null) ||
    a.id - b.id
  );
}

function groupByArea(jobs: ZoneJob[]): ZoneArea[] {
  const groups = new Map<number | null, ZoneJob[]>();
  for (const j of jobs) {
    const key = j.area?.id ?? null;
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  return [...groups.values()]
    .map((list) => ({
      id: list[0].area?.id ?? null,
      name: list[0].area?.name ?? null,
      count: countOf(list),
      jobs: [...list].sort(byStart),
    }))
    .sort((a, b) => byName(a.name, b.name));
}

export function groupZoneBoard(input: ZoneJob[]): ZoneGroups {
  // Each team reads Paster, Helper, Driver, then by name, as on the job form.
  const jobs = input.map((j) => ({
    ...j,
    members: [...j.members].sort(
      (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name),
    ),
  }));
  const local = jobs.filter((j) => j.locality === "LOCAL");
  const nonLocal = jobs.filter((j) => j.locality === "NON_LOCAL");
  const notSet = jobs.filter((j) => !j.locality);

  // Districts are typed in by hand on the area master, so "warangal " and "Warangal" are one
  // district, and a blank one counts as not set.
  const districtName = (j: ZoneJob) => j.area?.district?.trim() || null;
  const districts = new Map<string | null, ZoneJob[]>();
  for (const j of nonLocal) {
    const key = districtName(j)?.toLowerCase() ?? null;
    districts.set(key, [...(districts.get(key) ?? []), j]);
  }

  return {
    total: countOf(jobs),
    LOCAL: { count: countOf(local), areas: groupByArea(local) },
    NON_LOCAL: {
      count: countOf(nonLocal),
      districts: [...districts.values()]
        .map((list) => ({ name: districtName(list[0]), count: countOf(list), areas: groupByArea(list) }))
        .sort((a, b) => byName(a.name, b.name)),
    },
    NOT_SET: { count: countOf(notSet), areas: groupByArea(notSet) },
  };
}
