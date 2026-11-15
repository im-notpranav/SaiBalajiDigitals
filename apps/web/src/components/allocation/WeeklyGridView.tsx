import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JobDialog } from "./JobDialog";
import { usePrefetchJobLookups } from "./jobLookups";
import { JobDetailDialog } from "./JobDetailDialog";
import { CsmJobEditDialog } from "./CsmJobEditDialog";
import {
  JobStatusBadge,
  JobStatusMenu,
  LocalityTag,
  MineTag,
  cellStyles,
  compactNames,
} from "./JobBits";
import {
  FIELD_ROLE_LABELS,
  JOB_STATUS_LABELS,
  addDays,
  fetchCsmDailyBoard,
  fetchCsmWeeklyGrid,
  fetchMyWeeklyGrid,
  fetchWeeklyGrid,
  fetchWorkJobs,
  formatJobDates,
  jobPlace,
  todayIST,
  type FieldRole,
  type GridJob,
  type WeeklyGrid,
  type WorkJob,
  type WorkJobStatus,
} from "@/api/allocation";

/**
 * Who the work-allocation pages are drawn for. "manage": the Operation Manager and Admin, who
 * assign and edit. "csm": a CSM, who reads every job and updates only his own. "field": a
 * Paster, Helper or Driver, who sees only their own row and jobs. The API sends each only what
 * they may see; the mode only decides what the page offers.
 */
export type AllocationMode = "manage" | "csm" | "field";

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];
const TEAM_KEYS = { PASTER: "pasters", HELPER: "helpers", DRIVER: "drivers" } as const;
const LIVE = "ASSIGNED,STARTED,HOLD,COMPLETED";
type View = "dates" | "people";
type RoleFilter = FieldRole | "ALL";
const ROLE_FILTERS: [RoleFilter, string][] = [
  ["ALL", "All"],
  ["PASTER", "Pasters"],
  ["HELPER", "Helpers"],
  ["DRIVER", "Drivers"],
];
type DialogState = { job: WorkJob | null; date?: string; members?: number[] } | null;

/** The grid's query for each mode. Keys sit under the prefix each mode's saves invalidate. */
const gridQuery = (mode: AllocationMode, from: string, days: number) =>
  mode === "csm"
    ? { queryKey: ["csm-jobs", "grid", from, days], queryFn: () => fetchCsmWeeklyGrid(from, days) }
    : mode === "field"
      ? { queryKey: ["my", "work-jobs", "grid", from, days], queryFn: () => fetchMyWeeklyGrid(from, days) }
      : { queryKey: ["work-jobs", "grid", from, days], queryFn: () => fetchWeeklyGrid(from, days) };

/** The Monday on or before a YYYY-MM-DD date, so the grid always shows whole weeks. */
function mondayOf(d: string) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((day + 6) % 7));
}

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });

/** "Day 2 of 3 (21 – 23 Oct)" for a job running over several days. */
const dayOfJob = (date: string, job: { start_date: string; end_date: string; days: number }) =>
  `Day ${Math.round((Date.parse(date) - Date.parse(job.start_date)) / 86_400_000) + 1} of ${job.days} (${formatJobDates(job.start_date, job.end_date)})`;

/**
 * The week, date first. Each day shows only how much work it has; picking a day opens that
 * day's jobs and teams below the grid, where managers assign workers. The old person-by-day
 * sheet stays one click away under "By person". Shared by the managers' Weekly Grid, the CSM's
 * and the field staff's: see AllocationMode.
 */
export function WeeklyGridView({ mode }: { mode: AllocationMode }) {
  const manage = mode === "manage";
  const field = mode === "field";
  const today = todayIST();
  const [from, setFrom] = useState(() => mondayOf(today));
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<View>("dates");
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [csmEditing, setCsmEditing] = useState<WorkJob | null>(null);
  usePrefetchJobLookups(manage);
  const { data, isLoading, isPlaceholderData, error, refetch } = useQuery({
    ...gridQuery(mode, from, days),
    // Moving a week keeps the current one on screen, dimmed, until the next arrives, instead
    // of swapping the whole grid for a loader and back.
    placeholderData: keepPreviousData,
  });

  const to = addDays(from, days - 1);
  const showRange = (start: string, pick?: string) => {
    setFrom(start);
    const end = addDays(start, days - 1);
    // Keep the picked day if it is still on screen, else pick the first one shown.
    setSelected((s) => pick ?? (s >= start && s <= end ? s : start));
  };

  const selIndex = data?.dates.indexOf(selected) ?? -1;
  const onRole = (r: { role: FieldRole }) => role === "ALL" || r.role === role;
  const views: [View, string][] = [
    ["dates", "By date"],
    ["people", field ? "Table" : "By person"],
  ];

  return (
    <>
      <div className="surface-panel mb-4 flex flex-wrap items-center gap-2 p-3">
        {/* On a phone the date controls take one full row, the filters the rows below. */}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Earlier"
            onClick={() => showRange(addDays(from, -days))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            aria-label="Go to date"
            value={selected}
            onChange={(e) => e.target.value && showRange(mondayOf(e.target.value), e.target.value)}
            className="min-w-0 flex-1 sm:w-40 sm:flex-none"
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Later"
            onClick={() => showRange(addDays(from, days))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {(selected !== today || from !== mondayOf(today)) && (
            <Button
              variant="ghost"
              className="shrink-0 px-3"
              onClick={() => showRange(mondayOf(today), today)}
            >
              Today
            </Button>
          )}
        </div>
        <span className="min-w-0 text-sm text-muted-foreground">
          {fmt(from, { day: "numeric", month: "short" })} –{" "}
          {fmt(to, { day: "numeric", month: "short", year: "numeric" })}
        </span>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap">
          {/* Field staff see only themselves, so there is nobody to filter. */}
          {!field && (
            <div
              role="radiogroup"
              aria-label="Who to show"
              className="col-span-2 grid grid-cols-4 rounded-xl border bg-muted/40 p-1 text-sm sm:inline-flex"
            >
              {ROLE_FILTERS.map(([r, label]) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "min-h-8 min-w-0 truncate rounded-lg px-1.5 font-medium transition-colors sm:px-2.5",
                    role === r
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div
            role="radiogroup"
            aria-label="View"
            className="grid grid-cols-2 rounded-xl border bg-muted/40 p-1 text-sm sm:inline-flex"
          >
            {views.map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "min-h-8 min-w-0 truncate rounded-lg px-2 font-medium transition-colors sm:px-3",
                  view === v
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Select
            value={String(days)}
            onValueChange={(v) => {
              const n = Number(v);
              setDays(n);
              setSelected((s) => (s >= from && s <= addDays(from, n - 1) ? s : from));
            }}
          >
            <SelectTrigger className="w-[6.5rem] sm:w-32" aria-label="How many weeks">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">1 week</SelectItem>
              <SelectItem value="14">2 weeks</SelectItem>
              <SelectItem value="28">4 weeks</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <LoadingState label={field ? "Loading your week…" : "Loading the grid…"} />
      ) : !data ? (
        <ErrorState title="Couldn't load the grid" error={error} onRetry={() => refetch()} />
      ) : view === "dates" ? (
        <>
          <DateCalendar
            mode={mode}
            loading={isPlaceholderData}
            data={data}
            rows={data.rows.filter(onRole)}
            today={today}
            selected={selected}
            onSelect={setSelected}
          />
          {field ? (
            <FieldDayPanel loading={isPlaceholderData} data={data} date={selected} />
          ) : (
            <DayPanel
              mode={mode}
              date={selected}
              role={role}
              free={selIndex >= 0 ? data.free[selIndex] : undefined}
              onLeave={
                selIndex >= 0 ? data.rows.filter((r) => onRole(r) && r.leave[selIndex]).length : 0
              }
              onAssign={() => setDialog({ job: null, date: selected })}
              onOpenJob={setDetail}
            />
          )}
        </>
      ) : (
        <PeopleGrid
          mode={mode}
          loading={isPlaceholderData}
          data={data}
          role={role}
          today={today}
          onOpenJob={(id, date) => {
            if (!field) return setDetail(id);
            // Field staff have no details dialog: the day's card below the calendar has it all.
            setSelected(date);
            setView("dates");
          }}
          onNewJob={(date, member) => setDialog({ job: null, date, members: [member] })}
        />
      )}

      {manage && (
        <>
          <JobDetailDialog
            jobId={detail}
            onClose={() => setDetail(null)}
            onEdit={(job) => {
              setDetail(null);
              setDialog({ job });
            }}
          />
          <JobDialog
            open={!!dialog}
            job={dialog?.job}
            defaultDate={dialog?.date}
            defaultMemberIds={dialog?.members}
            onClose={() => setDialog(null)}
          />
        </>
      )}
      {mode === "csm" && (
        <>
          <JobDetailDialog
            mode="csm"
            jobId={detail}
            onClose={() => setDetail(null)}
            onEdit={(job) => {
              setDetail(null);
              setCsmEditing(job);
            }}
          />
          <CsmJobEditDialog job={csmEditing} onClose={() => setCsmEditing(null)} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// By date
// ---------------------------------------------------------------------------

/** Per day: how many jobs run, how many people are booked or on leave, and any clashes. */
function daySummaries(data: WeeklyGrid, rows: WeeklyGrid["rows"]) {
  return data.dates.map((_, i) => {
    const jobs = new Set<number>();
    let booked = 0;
    let clashes = 0;
    let leave = 0;
    for (const r of rows) {
      const cell = r.days[i];
      for (const c of cell) jobs.add(c.job_id);
      if (cell.length) booked++;
      if (r.leave[i]) leave++;
      if (cell.length > 1 || (r.leave[i] && cell.length > 0)) clashes++;
    }
    return { jobs: jobs.size, booked, clashes, leave };
  });
}

/** Whole weeks of day tiles. A tile shows counts only, never names. */
function DateCalendar({
  mode,
  loading,
  data,
  rows,
  today,
  selected,
  onSelect,
}: {
  mode: AllocationMode;
  /** The tiles are still the last range's while the new one loads. */
  loading?: boolean;
  data: WeeklyGrid;
  /** The people counted: all of them, or one role (field staff: only themselves). */
  rows: WeeklyGrid["rows"];
  today: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const field = mode === "field";
  const sums = daySummaries(data, rows);
  return (
    <div
      aria-busy={loading}
      className={cn(
        "surface-panel mb-4 p-2 transition-opacity duration-150 sm:p-3",
        loading && "pointer-events-none opacity-60",
      )}
    >
      <div className="mb-1 grid grid-cols-7 gap-1 sm:gap-2" aria-hidden>
        {data.dates.slice(0, 7).map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <span className="sm:hidden">{fmt(d, { weekday: "narrow" })}</span>
            <span className="hidden sm:inline">{fmt(d, { weekday: "short" })}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {data.dates.map((d, i) => {
          const s = sums[i];
          const isSel = d === selected;
          const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
          // A field person's own leave day is tinted, since a tile has no room for the word.
          const ownLeave = field && s.leave > 0;
          const label = `${fmt(d, { weekday: "long", day: "numeric", month: "long" })}: ${
            s.jobs
              ? `${s.jobs} job${s.jobs === 1 ? "" : "s"}${field ? "" : `, ${s.booked} booked`}`
              : "no work"
          }${ownLeave ? ", on leave" : ""}${s.clashes ? `, ${s.clashes} clash${s.clashes === 1 ? "" : "es"}` : ""}`;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={isSel}
              aria-label={label}
              onClick={() => onSelect(d)}
              className={cn(
                "relative flex min-h-16 min-w-0 flex-col items-center justify-between gap-1 rounded-xl border p-1.5 text-center transition-colors sm:min-h-24 sm:items-start sm:p-2.5 sm:text-left",
                isSel
                  ? "border-primary bg-primary/10 ring-2 ring-primary/40"
                  : ownLeave
                    ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                    : sunday
                      ? "bg-muted/50 hover:bg-muted"
                      : "hover:bg-muted/50",
              )}
            >
              <div className="flex w-full flex-wrap items-start justify-center gap-x-1 sm:justify-between">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums sm:text-xl",
                    d === today && "text-primary",
                  )}
                >
                  {fmt(d, { day: "numeric" })}
                  <span className="ml-1 hidden text-xs font-normal text-muted-foreground lg:inline">
                    {fmt(d, { month: "short" })}
                  </span>
                </span>
                {d === today && (
                  <span className="hidden rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground sm:inline">
                    Today
                  </span>
                )}
              </div>
              {s.jobs > 0 ? (
                <div className="flex w-full flex-col items-center gap-0.5 sm:items-start">
                  <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold tabular-nums text-primary sm:px-2 sm:text-xs">
                    {s.jobs}
                    <span className="hidden sm:inline"> job{s.jobs === 1 ? "" : "s"}</span>
                  </span>
                  {!field && (
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {s.booked} booked
                    </span>
                  )}
                </div>
              ) : (
                <span
                  className={cn(
                    "hidden text-xs sm:block",
                    ownLeave ? "font-medium text-destructive" : "text-muted-foreground",
                  )}
                >
                  {ownLeave ? "On leave" : "No work"}
                </span>
              )}
              {/* Field staff: only their own leave over a job is worth a warning. */}
              {(field ? ownLeave && s.jobs > 0 : s.clashes > 0) && (
                <>
                  <span
                    className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive sm:hidden"
                    aria-hidden
                  />
                  <span className="hidden items-center gap-1 text-[11px] font-medium text-destructive sm:flex">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {field ? "On leave" : `${s.clashes} clash${s.clashes === 1 ? "" : "es"}`}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** [{ label: "Pasters", names: ["Abdul", "Ravi"] }, { label: "Driver", … }] */
function teamByRole(members: WorkJob["members"]) {
  return ROLES.flatMap((r) => {
    const names = members.filter((m) => m.slot_role === r).map((m) => m.name);
    return names.length
      ? [{ role: r, label: `${FIELD_ROLE_LABELS[r]}${names.length > 1 ? "s" : ""}`, names }]
      : [];
  });
}

/** The day panel's jobs: managers read the jobs list, a CSM the board (shared with his board page). */
const dayQuery = (mode: AllocationMode, date: string) =>
  mode === "csm"
    ? { queryKey: ["csm-jobs", "board", date], queryFn: () => fetchCsmDailyBoard(date) }
    : {
        queryKey: ["work-jobs", "list", { from: date, to: date, status: LIVE }],
        queryFn: () => fetchWorkJobs({ from: date, to: date, status: LIVE }),
      };

/** One day's work: its jobs with their teams, and who is still free. */
function DayPanel({
  mode,
  date,
  role,
  free,
  onLeave,
  onAssign,
  onOpenJob,
}: {
  mode: AllocationMode;
  date: string;
  role: RoleFilter;
  free: Record<FieldRole, number> | undefined;
  onLeave: number;
  onAssign: () => void;
  onOpenJob: (id: number) => void;
}) {
  const manage = mode === "manage";
  const { data, isLoading, isPlaceholderData } = useQuery<{ jobs: WorkJob[] }>({
    ...dayQuery(mode, date),
    // Picking another day keeps the last day's cards, dimmed, so the panel does not collapse
    // to a spinner and spring back open.
    placeholderData: keepPreviousData,
  });
  const jobs = (data?.jobs ?? []).filter(
    (j) => role === "ALL" || j.members.some((m) => m.slot_role === role),
  );
  const freeRoles = role === "ALL" ? ROLES : [role];

  return (
    <section className="surface-panel p-4 sm:p-5" aria-labelledby="day-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="day-title" className="text-lg font-semibold">
            {fmt(date, { weekday: "long", day: "numeric", month: "long" })}
          </h2>
          {free ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Free:{" "}
              {freeRoles.map((r, i) => (
                <Fragment key={r}>
                  {i > 0 && " · "}
                  <span className={cn(free[r] === 0 && "font-medium text-destructive")}>
                    {free[r]} {FIELD_ROLE_LABELS[r].toLowerCase()}
                    {free[r] === 1 ? "" : "s"}
                  </span>
                </Fragment>
              ))}
              {onLeave > 0 && ` · ${onLeave} on leave`}
            </p>
          ) : (
            // Holds the line's height while a new week loads, so nothing below jumps.
            <p className="mt-0.5 h-5" aria-hidden />
          )}
        </div>
        {manage && (
          <Button className="rounded-xl" onClick={onAssign}>
            <Plus className="mr-2 h-4 w-4" /> Assign workers
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingState bare className="p-4" />
      ) : jobs.length === 0 ? (
        <div
          aria-busy={isPlaceholderData}
          className={cn(
            "rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground transition-opacity duration-150",
            isPlaceholderData && "opacity-60",
          )}
        >
          {isPlaceholderData
            ? "Loading this date…"
            : manage
              ? "Nothing is booked on this date. Use “Assign workers” to book a team."
              : "Nothing is booked on this date."}
        </div>
      ) : (
        <ul
          aria-busy={isPlaceholderData}
          className={cn(
            "grid gap-3 transition-opacity duration-150 md:grid-cols-2",
            isPlaceholderData && "pointer-events-none opacity-60",
          )}
        >
          {jobs.map((j) => {
            const team = teamByRole(j.members);
            return (
              <li key={j.id} className="grid min-w-0 content-start gap-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 text-left hover:underline"
                    onClick={() => onOpenJob(j.id)}
                  >
                    <div className="font-mono font-semibold">
                      {j.order?.order_no ?? "No order"}
                    </div>
                    {j.order && (
                      <div
                        className="truncate text-xs text-muted-foreground"
                        title={j.order.client_name}
                      >
                        {j.order.client_name}
                      </div>
                    )}
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {j.mine && <MineTag />}
                    {manage ? <JobStatusMenu job={j} /> : <JobStatusBadge status={j.status} />}
                  </div>
                </div>
                {j.work_details && <p className="break-words text-sm">{j.work_details}</p>}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {jobPlace(j) ?? "Location not set"} <LocalityTag locality={j.locality} />
                  </span>
                  {/* A held-over card belongs to the last day picked, so its day number would be wrong. */}
                  {j.days > 1 && !isPlaceholderData && <span>· {dayOfJob(date, j)}</span>}
                </div>
                <dl className="grid gap-1 rounded-lg bg-muted/30 p-2 text-sm">
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                    <dt className="text-xs leading-5 text-muted-foreground">CSM</dt>
                    <dd className="break-words">{j.csm?.name ?? "Not set"}</dd>
                  </div>
                  {team.length === 0 ? (
                    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                      <dt className="text-xs leading-5 text-muted-foreground">Team</dt>
                      <dd className="text-muted-foreground">No team yet</dd>
                    </div>
                  ) : (
                    team.map((t) => (
                      <div key={t.role} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                        <dt className="text-xs leading-5 text-muted-foreground">{t.label}</dt>
                        <dd className="break-words">{t.names.join(", ")}</dd>
                      </div>
                    ))
                  )}
                </dl>
                <div>
                  <Button size="sm" variant="ghost" onClick={() => onOpenJob(j.id)}>
                    Open details
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * A field person's own day: the jobs they are on, from the grid itself (no second fetch), with
 * no team names. Starting and completing stay on My Work.
 */
function FieldDayPanel({
  loading,
  data,
  date,
}: {
  loading?: boolean;
  data: WeeklyGrid;
  date: string;
}) {
  const i = data.dates.indexOf(date);
  const row = data.rows[0];
  const cells = i >= 0 && row ? row.days[i] : [];
  const onLeave = i >= 0 && !!row?.leave[i];
  const jobs = cells.flatMap((c) => {
    const job = data.jobs[c.job_id];
    return job ? [{ id: c.job_id, ...job }] : [];
  });
  // A held-over panel belongs to the last range shown until the new one arrives.
  const waiting = loading || i < 0;

  return (
    <section className="surface-panel p-4 sm:p-5" aria-labelledby="day-title">
      <div className="mb-4 min-w-0">
        <h2 id="day-title" className="text-lg font-semibold">
          {fmt(date, { weekday: "long", day: "numeric", month: "long" })}
        </h2>
        <p className="mt-0.5 min-h-5 text-sm text-muted-foreground">
          {waiting
            ? null
            : jobs.length
              ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}`
              : onLeave
                ? "On leave"
                : "No work"}
        </p>
      </div>

      {onLeave && !waiting && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          You are on leave on this day.
          {jobs.length > 0 && " Ask the Operations Manager about the job below."}
        </div>
      )}

      {jobs.length === 0 ? (
        <div
          aria-busy={waiting}
          className={cn(
            "rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground transition-opacity duration-150",
            waiting && "opacity-60",
          )}
        >
          {waiting ? "Loading this date…" : "No work on this date."}
        </div>
      ) : (
        <ul
          aria-busy={waiting}
          className={cn(
            "grid gap-3 transition-opacity duration-150 md:grid-cols-2",
            waiting && "pointer-events-none opacity-60",
          )}
        >
          {jobs.map((j) => (
            <li key={j.id} className="grid min-w-0 content-start gap-2 rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono font-semibold">
                    {j.order_no ?? "Order to be confirmed"}
                  </div>
                  {j.client_name && (
                    <div className="truncate text-xs text-muted-foreground" title={j.client_name}>
                      {j.client_name}
                    </div>
                  )}
                </div>
                <JobStatusBadge status={j.status} />
              </div>
              <p className="break-words text-sm font-medium">
                {j.work_details ?? "Work details to follow"}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {j.place ?? "Location to be confirmed"} <LocalityTag locality={j.locality} />
                </span>
                {j.days > 1 && <span>· {dayOfJob(date, j)}</span>}
              </div>
              {j.csm && (
                <div className="text-sm">
                  <span className="text-xs text-muted-foreground">CSM: </span>
                  {j.csm}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Start or complete a job from{" "}
        <Link to="/field/dashboard" className="font-medium text-primary hover:underline">
          My Work
        </Link>
        .
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// By person (the old WAS sheet)
// ---------------------------------------------------------------------------

/**
 * A job in a grid cell. Managers and CSMs see its order, CSM and team, any number of each
 * role ("Ravi +2"); field staff see its order, place and CSM. A click opens the details.
 */
function JobBox({
  mode,
  job,
  status,
  onClick,
}: {
  mode: AllocationMode;
  job: GridJob | undefined;
  status: WorkJobStatus;
  onClick: () => void;
}) {
  const orderNo = job?.order_no ?? "No order";
  const line = (label: string, value: string, title = value) => (
    <span className="block truncate" title={`${label}: ${title}`}>
      <span className="opacity-70">{label}:</span> {value}
    </span>
  );
  const team = job
    ? ROLES.flatMap((r) => {
        const names = job[TEAM_KEYS[r]];
        return names.length ? [{ role: r, names }] : [];
      })
    : [];
  return (
    <button
      type="button"
      aria-label={`${orderNo}, ${JOB_STATUS_LABELS[status]}. ${mode === "field" ? "Show this day." : "Open details."}`}
      className={cn(
        "block w-full min-w-0 rounded-md border px-1.5 py-1 text-left text-[11px] leading-4",
        cellStyles[status],
      )}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate font-mono font-semibold" title={orderNo}>
          {orderNo}
        </span>
        {job?.mine && (
          <span className="shrink-0 rounded bg-primary px-1 text-[9px] font-semibold uppercase leading-3 text-primary-foreground">
            You
          </span>
        )}
      </span>
      {mode === "field" ? (
        <>
          {line("At", job?.place ?? "To be confirmed")}
          {line("CSM", job?.csm ?? "—")}
        </>
      ) : (
        <>
          {line("CSM", job?.csm ?? "—")}
          {team.length === 0 ? (
            <span className="block truncate opacity-70">No team</span>
          ) : (
            team.map((t) => (
              <Fragment key={t.role}>
                {line(
                  `${FIELD_ROLE_LABELS[t.role]}${t.names.length > 1 ? "s" : ""}`,
                  compactNames(t.names),
                  t.names.join(", "),
                )}
              </Fragment>
            ))
          )}
        </>
      )}
    </button>
  );
}

/**
 * One row per person, one column per day, each cell boxing the person's jobs. Click a box to
 * open the job's details. Managers can also click an empty cell to start a job for that person
 * on that day. Field staff get only their own row.
 */
function PeopleGrid({
  mode,
  loading,
  data,
  role,
  today,
  onOpenJob,
  onNewJob,
}: {
  mode: AllocationMode;
  /** The sheet is still the last range's while the new one loads. */
  loading?: boolean;
  data: WeeklyGrid;
  role: RoleFilter;
  today: string;
  onOpenJob: (id: number, date: string) => void;
  onNewJob: (date: string, member: number) => void;
}) {
  const manage = mode === "manage";
  const field = mode === "field";
  const dates = data.dates;
  const roles = role === "ALL" ? ROLES : [role];
  const head = (d: string) => ({
    day: fmt(d, { weekday: "short" }),
    date: fmt(d, { day: "numeric", month: "short" }),
    sunday: new Date(`${d}T00:00:00Z`).getUTCDay() === 0,
  });

  return (
    <>
      <div
        aria-busy={loading}
        className={cn(
          "surface-panel overflow-x-auto transition-opacity duration-150",
          loading && "pointer-events-none opacity-60",
        )}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              {/* A phone keeps the name column narrow, so a day's column still fits beside it. */}
              <th className="sticky left-0 z-10 w-28 min-w-28 border-b bg-muted px-2 py-2 text-left text-xs font-medium text-muted-foreground sm:w-auto sm:min-w-[11rem] sm:px-3">
                Person
              </th>
              {dates.map((d) => {
                const h = head(d);
                return (
                  <th
                    key={d}
                    className={cn(
                      "min-w-[8.5rem] border-b border-l px-2 py-2 text-center text-xs font-medium sm:min-w-[10rem]",
                      d === today
                        ? "bg-primary/10 text-primary"
                        : h.sunday
                          ? "bg-muted/70 text-muted-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    <div>{h.day}</div>
                    <div className="font-semibold text-foreground">{h.date}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {roles.map((rowRole) => {
              const rows = data.rows.filter((r) => r.role === rowRole);
              if (rows.length === 0) return null;
              return (
                <Fragment key={rowRole}>
                  {/* One person needs no role heading above their own row. */}
                  {!field && (
                    <tr>
                      <td
                        colSpan={dates.length + 1}
                        className="sticky left-0 border-b bg-background px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {FIELD_ROLE_LABELS[rowRole]}s
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.id} className="group">
                      <td className="sticky left-0 z-10 max-w-28 border-b bg-card px-2 py-1.5 group-hover:bg-muted sm:max-w-[11rem] sm:px-3">
                        <div className="break-words font-medium leading-tight sm:truncate" title={r.name}>
                          {r.name}
                        </div>
                        {r.emp_code && (
                          <div className="text-xs text-muted-foreground">{r.emp_code}</div>
                        )}
                      </td>
                      {r.days.map((cell, i) => (
                        <td
                          key={dates[i]}
                          className={cn(
                            "border-b border-l p-1 align-top",
                            (cell.length > 1 || (r.leave[i] && cell.length > 0)) &&
                              "bg-destructive/10",
                            dates[i] === today && cell.length < 2 && "bg-primary/5",
                          )}
                        >
                          {r.leave[i] && cell.length === 0 ? (
                            <div className="flex h-8 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-[11px] font-semibold text-destructive">
                              Leave
                            </div>
                          ) : cell.length === 0 ? (
                            manage ? (
                              <button
                                type="button"
                                aria-label={`New job for ${r.name} on ${dates[i]}`}
                                className="h-8 w-full rounded-md text-xs text-transparent transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:text-muted-foreground"
                                onClick={() => onNewJob(dates[i], r.id)}
                              >
                                + job
                              </button>
                            ) : (
                              // Same height as a manager's empty cell, so rows line up alike.
                              <div className="h-8" aria-hidden />
                            )
                          ) : (
                            <div className="grid gap-1">
                              {r.leave[i] && (
                                <div className="flex h-8 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-[11px] font-semibold text-destructive">
                                  Leave
                                </div>
                              )}
                              {cell.map((c) => (
                                <JobBox
                                  key={c.job_id}
                                  mode={mode}
                                  job={data.jobs[c.job_id]}
                                  status={c.status}
                                  onClick={() => onOpenJob(c.job_id, dates[i])}
                                />
                              ))}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={dates.length + 1} className="p-8 text-center text-muted-foreground">
                  {manage ? "No active field staff yet. Add them under Field Staff." : "No field staff yet."}
                </td>
              </tr>
            )}
          </tbody>
          {/* Field staff are not sent how many others are free. */}
          {data.free.length > 0 && (
            <tfoot>
              {roles.map((footRole) => (
                <tr key={footRole} className="bg-muted/30 text-xs">
                  <td className="sticky left-0 z-10 border-t bg-muted px-2 py-1.5 font-medium text-muted-foreground sm:px-3">
                    Free {FIELD_ROLE_LABELS[footRole].toLowerCase()}s
                  </td>
                  {data.free.map((f, i) => (
                    <td
                      key={dates[i]}
                      className={cn(
                        "border-l border-t px-2 py-1.5 text-center font-semibold tabular-nums",
                        f[footRole] === 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {f[footRole]}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded border border-destructive/30 bg-destructive/10" /> Leave
        </span>
        {(["ASSIGNED", "STARTED", "HOLD", "COMPLETED"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("h-3 w-5 rounded border", cellStyles[s])} /> {JOB_STATUS_LABELS[s]}
          </span>
        ))}
      </div>
    </>
  );
}
