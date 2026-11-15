/**
 * Date handling shared by the Reports endpoints.
 *
 * Every report takes a `from` and `to` day (YYYY-MM-DD, both included) read in India time,
 * whatever the server's own zone. Timestamps are compared against [start, end), where start
 * is `from` 00:00 IST and end is the midnight after `to`. Date-only columns (field jobs,
 * leave, overtime) are stored at UTC midnight, so they compare against the plain day strings.
 */

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The longest range a report accepts, so one request cannot scan years of rows by mistake. */
export const MAX_RANGE_DAYS = 3 * 366;

export interface ReportRange {
  /** First day, YYYY-MM-DD, India time. */
  from: string;
  /** Last day, YYYY-MM-DD, India time, included. */
  to: string;
  /** `from` 00:00 IST. */
  start: Date;
  /** The midnight (IST) after `to`: compare with `lt`. */
  end: Date;
  /** `from` and `to` at UTC midnight, for @db.Date columns. */
  dateFrom: Date;
  dateTo: Date;
}

/** A bad ?from / ?to: the controller answers 400 with the message. */
export class RangeError400 extends Error {}

/** Today in India time, YYYY-MM-DD. */
export const todayIst = (now: Date = new Date()): string => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);

/** 1 April of the financial year `day` falls in. */
export function fyStartOf(day: string): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return `${m >= 4 ? y : y - 1}-04-01`;
}

const validDay = (s: string) =>
  DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Reads ?from and ?to. Both default: `from` to the start of the current financial year and
 * `to` to today. Throws RangeError400 for a malformed day, a reversed range or one too long.
 */
export function parseRange(query: { from?: unknown; to?: unknown }, now: Date = new Date()): ReportRange {
  const today = todayIst(now);
  const to = query.to ? String(query.to) : today;
  const from = query.from ? String(query.from) : fyStartOf(to);
  if (!validDay(from) || !validDay(to)) throw new RangeError400("Dates must be written YYYY-MM-DD.");
  if (from > to) throw new RangeError400("The start date is after the end date.");
  const dateFrom = new Date(`${from}T00:00:00Z`);
  const dateTo = new Date(`${to}T00:00:00Z`);
  if ((dateTo.getTime() - dateFrom.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    throw new RangeError400("Pick a range of three years or less.");
  }
  return {
    from,
    to,
    start: new Date(dateFrom.getTime() - IST_MS),
    end: new Date(dateTo.getTime() + DAY_MS - IST_MS),
    dateFrom,
    dateTo,
  };
}

/** Whether a timestamp falls inside the range. */
export const inRange = (d: Date | string | null | undefined, r: ReportRange): boolean => {
  if (d == null) return false;
  const t = new Date(d).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

/** The India-time day of a timestamp, YYYY-MM-DD. */
export const istDay = (d: Date | string): string => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);

/** The India-time month of a timestamp, YYYY-MM. */
export const istMonth = (d: Date | string): string => istDay(d).slice(0, 7);

/** Every month the range touches, in order, as YYYY-MM. */
export function monthsOf(r: ReportRange): string[] {
  const out: string[] = [];
  let [y, m] = r.from.split("-").map(Number) as [number, number];
  const last = r.to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Every day of the range, in order, as YYYY-MM-DD. */
export function daysOf(r: ReportRange): string[] {
  const out: string[] = [];
  for (let t = r.dateFrom.getTime(); t <= r.dateTo.getTime(); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-04" reads "Apr 26". */
export const monthLabel = (key: string): string => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

/** Whole calendar days from one moment to another, never negative. */
export const calendarDays = (from: Date | string, to: Date | string = new Date()): number =>
  Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS));

/**
 * Days that two inclusive date-only spans share. Both spans are UTC-midnight dates (the
 * @db.Date columns). When `workingOnly` is set, Sundays are left out.
 */
export function overlapDays(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date, workingOnly = false): number {
  const s = Math.max(new Date(aFrom).getTime(), new Date(bFrom).getTime());
  const e = Math.min(new Date(aTo).getTime(), new Date(bTo).getTime());
  if (e < s) return 0;
  if (!workingOnly) return Math.round((e - s) / DAY_MS) + 1;
  let n = 0;
  for (let t = s; t <= e; t += DAY_MS) if (new Date(t).getUTCDay() !== 0) n++;
  return n;
}

/** Monday-to-Saturday days in the range. */
export const workingDaysIn = (r: ReportRange): number => overlapDays(r.dateFrom, r.dateTo, r.dateFrom, r.dateTo, true);

/**
 * Puts a day count into the first bucket whose upper edge it does not pass.
 * `ageBucket(45, [30, 60, 90])` is "31–60"; anything past the last edge is "90+".
 */
export function ageBucket(days: number, edges: number[]): string {
  let low = 0;
  for (const edge of edges) {
    if (days <= edge) return `${low}–${edge}`;
    low = edge + 1;
  }
  return `${edges[edges.length - 1]}+`;
}

/** Every bucket label `ageBucket` can return for these edges, in order. */
export const bucketLabels = (edges: number[]): string[] => [
  ...edges.map((e, i) => `${i === 0 ? 0 : edges[i - 1]! + 1}–${e}`),
  `${edges[edges.length - 1]}+`,
];

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

/** A whole-number percentage, or null when there is nothing to divide by. */
export const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** The mean to one decimal place, or null for an empty list. */
export const mean1 = (xs: number[]): number | null => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Adds `value` to the running total under `key`, creating it on first use. */
export function tally<K>(map: Map<K, number>, key: K, value = 1) {
  map.set(key, (map.get(key) ?? 0) + value);
}
