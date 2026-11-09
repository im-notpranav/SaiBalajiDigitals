import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { JobDialog } from "@/components/allocation/JobDialog";
import { usePrefetchJobLookups } from "@/components/allocation/jobLookups";
import { JobDetailDialog } from "@/components/allocation/JobDetailDialog";
import { JobStatusMenu, LocalityTag, cellStyles } from "@/components/allocation/JobBits";
import {
  FIELD_ROLE_LABELS,
  JOB_STATUS_LABELS,
  addDays,
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

export const Route = createFileRoute("/_portal/admin/grid")({
  head: () => ({ meta: [{ title: "Weekly Grid — SB OMS" }] }),
  component: WeeklyGridPage,
});

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];
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

/** The Monday on or before a YYYY-MM-DD date, so the grid always shows whole weeks. */
function mondayOf(d: string) {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((day + 6) % 7));
}

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });

/**
 * The week, date first. Each day shows only how much work it has; picking a day opens that
 * day's jobs and teams below the grid, where workers are assigned. The old person-by-day
 * sheet stays one click away under "By person".
 */
function WeeklyGridPage() {
  const today = todayIST();
  const [from, setFrom] = useState(() => mondayOf(today));
  const [days, setDays] = useState(7);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<View>("dates");
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [detail, setDetail] = useState<number | null>(null);
  usePrefetchJobLookups();
  const { data, isLoading, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ["work-jobs", "grid", from, days],
    queryFn: () => fetchWeeklyGrid(from, days),
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

  return (
    <>
      <PageHeader
        title="Weekly Grid"
        description="Pick a date to assign its work."
        crumbs={[{ label: "Work Allocation" }, { label: "Weekly Grid" }]}
      />

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
          <div
            role="radiogroup"
            aria-label="View"
            className="grid grid-cols-2 rounded-xl border bg-muted/40 p-1 text-sm sm:inline-flex"
          >
            {(
              [
                ["dates", "By date"],
                ["people", "By person"],
              ] as const
            ).map(([v, label]) => (
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
        <LoadingState label="Loading the grid…" />
      ) : !data ? (
        <ErrorState title="Couldn't load the grid" error={error} onRetry={() => refetch()} />
      ) : view === "dates" ? (
        <>
          <DateCalendar
            loading={isPlaceholderData}
            data={data}
            rows={data.rows.filter(onRole)}
            today={today}
            selected={selected}
            onSelect={setSelected}
          />
          <DayPanel
            date={selected}
            role={role}
            free={selIndex >= 0 ? data.free[selIndex] : undefined}
            onLeave={
              selIndex >= 0 ? data.rows.filter((r) => onRole(r) && r.leave[selIndex]).length : 0
            }
            onAssign={() => setDialog({ job: null, date: selected })}
            onOpenJob={setDetail}
          />
        </>
      ) : (
        <PeopleGrid
          loading={isPlaceholderData}
          data={data}
          role={role}
          today={today}
          onOpenJob={setDetail}
          onNewJob={(date, member) => setDialog({ job: null, date, members: [member] })}
        />
      )}

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
  );
}

// ---------------------------------------------------------------------------
// By date
// ---------------------------------------------------------------------------

/** Per day: how many jobs run, how many people are booked, and whether anyone clashes. */
function daySummaries(data: WeeklyGrid, rows: WeeklyGrid["rows"]) {
  return data.dates.map((_, i) => {
    const jobs = new Set<number>();
    let booked = 0;
    let clashes = 0;
    for (const r of rows) {
      const cell = r.days[i];
      for (const c of cell) jobs.add(c.job_id);
      if (cell.length) booked++;
      if (cell.length > 1 || (r.leave[i] && cell.length > 0)) clashes++;
    }
    return { jobs: jobs.size, booked, clashes };
  });
}

/** Whole weeks of day tiles. A tile shows counts only, never names. */
function DateCalendar({
  loading,
  data,
  rows,
  today,
  selected,
  onSelect,
}: {
  /** The tiles are still the last range's while the new one loads. */
  loading?: boolean;
  data: WeeklyGrid;
  /** The people counted: all of them, or one role. */
  rows: WeeklyGrid["rows"];
  today: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
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
          const label = `${fmt(d, { weekday: "long", day: "numeric", month: "long" })}: ${
            s.jobs ? `${s.jobs} job${s.jobs === 1 ? "" : "s"}, ${s.booked} booked` : "no work"
          }${s.clashes ? `, ${s.clashes} clash${s.clashes === 1 ? "" : "es"}` : ""}`;
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
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {s.booked} booked
                  </span>
                </div>
              ) : (
                <span className="hidden text-xs text-muted-foreground sm:block">No work</span>
              )}
              {s.clashes > 0 && (
                <>
                  <span
                    className="absolute right-1 top-1 h-2 w-2 rounded-full bg-destructive sm:hidden"
                    aria-hidden
                  />
                  <span className="hidden items-center gap-1 text-[11px] font-medium text-destructive sm:flex">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {s.clashes} clash
                    {s.clashes === 1 ? "" : "es"}
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

/** One day's work: its jobs with their teams, and who is still free. */
function DayPanel({
  date,
  role,
  free,
  onLeave,
  onAssign,
  onOpenJob,
}: {
  date: string;
  role: RoleFilter;
  free: Record<FieldRole, number> | undefined;
  onLeave: number;
  onAssign: () => void;
  onOpenJob: (id: number) => void;
}) {
  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["work-jobs", "list", { from: date, to: date, status: LIVE }],
    queryFn: () => fetchWorkJobs({ from: date, to: date, status: LIVE }),
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
        <Button className="rounded-xl" onClick={onAssign}>
          <Plus className="mr-2 h-4 w-4" /> Assign workers
        </Button>
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
            : "Nothing is booked on this date. Use “Assign workers” to book a team."}
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
            const dayNo =
              Math.round((Date.parse(date) - Date.parse(j.start_date)) / 86_400_000) + 1;
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
                  <JobStatusMenu job={j} />
                </div>
                {j.work_details && <p className="break-words text-sm">{j.work_details}</p>}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {jobPlace(j) ?? "Location not set"} <LocalityTag locality={j.locality} />
                  </span>
                  {/* A held-over card belongs to the last day picked, so its day number would be wrong. */}
                  {j.days > 1 && !isPlaceholderData && (
                    <span>
                      · Day {dayNo} of {j.days} ({formatJobDates(j.start_date, j.end_date)})
                    </span>
                  )}
                </div>
                <dl className="grid gap-1 rounded-lg bg-muted/30 p-2 text-sm">
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                    <dt className="text-xs leading-5 text-muted-foreground">CSM</dt>
                    <dd className="break-words">{j.csm?.name ?? "Not set"}</dd>
                  </div>
                  {teamByRole(j.members).map((t) => (
                    <div key={t.role} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                      <dt className="text-xs leading-5 text-muted-foreground">{t.label}</dt>
                      <dd className="break-words">{t.names.join(", ")}</dd>
                    </div>
                  ))}
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

// ---------------------------------------------------------------------------
// By person (the old WAS sheet)
// ---------------------------------------------------------------------------

/** A job in a grid cell: its order, CSM, Pasters and Driver, always. A click opens the details. */
function JobBox({
  job,
  status,
  onClick,
}: {
  job: GridJob | undefined;
  status: WorkJobStatus;
  onClick: () => void;
}) {
  const orderNo = job?.order_no ?? "No order";
  const line = (label: string, value: string) => (
    <span className="block truncate" title={`${label}: ${value}`}>
      <span className="opacity-70">{label}:</span> {value}
    </span>
  );
  return (
    <button
      type="button"
      aria-label={`${orderNo}, ${JOB_STATUS_LABELS[status]}. Open details.`}
      className={cn(
        "block w-full min-w-0 rounded-md border px-1.5 py-1 text-left text-[11px] leading-4",
        cellStyles[status],
      )}
      onClick={onClick}
    >
      <span className="block truncate font-mono font-semibold" title={orderNo}>
        {orderNo}
      </span>
      {line("CSM", job?.csm ?? "—")}
      {line("Paster", job?.pasters.join(", ") || "—")}
      {line("Driver", job?.drivers.join(", ") || "—")}
    </button>
  );
}

/**
 * One row per person, one column per day, each cell boxing the person's jobs. Click a box to
 * open the job's details, or an empty cell to start a job for that person on that day.
 */
function PeopleGrid({
  loading,
  data,
  role,
  today,
  onOpenJob,
  onNewJob,
}: {
  /** The sheet is still the last range's while the new one loads. */
  loading?: boolean;
  data: WeeklyGrid;
  role: RoleFilter;
  today: string;
  onOpenJob: (id: number) => void;
  onNewJob: (date: string, member: number) => void;
}) {
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
                  <tr>
                    <td
                      colSpan={dates.length + 1}
                      className="sticky left-0 border-b bg-background px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {FIELD_ROLE_LABELS[rowRole]}s
                    </td>
                  </tr>
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
                            <button
                              type="button"
                              aria-label={`New job for ${r.name} on ${dates[i]}`}
                              className="h-8 w-full rounded-md text-xs text-transparent transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:text-muted-foreground"
                              onClick={() => onNewJob(dates[i], r.id)}
                            >
                              + job
                            </button>
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
                                  job={data.jobs[c.job_id]}
                                  status={c.status}
                                  onClick={() => onOpenJob(c.job_id)}
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
                  No active field staff yet. Add them under Field Staff.
                </td>
              </tr>
            )}
          </tbody>
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
