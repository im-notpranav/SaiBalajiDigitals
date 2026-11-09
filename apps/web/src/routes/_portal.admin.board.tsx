import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  HardHat,
  Phone,
  Plus,
  Truck,
  Users,
  Wrench,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JobDialog } from "@/components/allocation/JobDialog";
import { usePrefetchJobLookups } from "@/components/allocation/jobLookups";
import { JobStatusMenu, LocalityTag } from "@/components/allocation/JobBits";
import {
  FIELD_ROLE_LABELS,
  JOB_EDITABLE,
  addDays,
  fetchDailyBoard,
  formatJobDates,
  jobPlace,
  todayIST,
  type FieldRole,
  type WorkJob,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/board")({
  head: () => ({ meta: [{ title: "Daily Board — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>): { date?: string } => ({
    date: typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : undefined,
  }),
  component: DailyBoardPage,
});

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];

/** One day at a glance: every job running, who is free by role, and who is double-booked. */
function DailyBoardPage() {
  const today = todayIST();
  const linked = Route.useSearch();
  const [date, setDate] = useState(linked.date ?? today);
  const [dialog, setDialog] = useState<{ job: WorkJob | null } | null>(null);
  usePrefetchJobLookups();
  const { data, isLoading, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ["work-jobs", "board", date],
    queryFn: () => fetchDailyBoard(date),
    // Stepping a day keeps the last day on screen, dimmed, until the next arrives, instead of
    // dropping every card to a loader and back.
    placeholderData: keepPreviousData,
  });
  const stale = cn(
    "transition-opacity duration-150",
    isPlaceholderData && "pointer-events-none opacity-60",
  );

  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const doubled = (data?.busy ?? []).filter((p) => p.jobs.length > 1);

  return (
    <>
      <PageHeader
        title="Daily Board"
        description={date === today ? `Today · ${label}` : label}
        crumbs={[{ label: "Work Allocation" }, { label: "Daily Board" }]}
        actions={
          <Button className="rounded-xl" onClick={() => setDialog({ job: null })}>
            <Plus className="mr-2 h-4 w-4" /> New job
          </Button>
        }
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous day"
          onClick={() => setDate(addDays(date, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          aria-label="Day"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-auto min-w-0 flex-1 sm:w-44 sm:flex-none"
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Next day"
          onClick={() => setDate(addDays(date, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {date !== today && (
          <Button variant="ghost" onClick={() => setDate(today)}>
            Today
          </Button>
        )}
      </div>

      <div
        aria-busy={isPlaceholderData}
        className={cn("mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6", stale)}
      >
        <KpiCard
          label="Jobs running"
          value={data?.counts.jobs ?? "–"}
          icon={Wrench}
          accent="primary"
        />
        <KpiCard
          label="Free pasters"
          value={data?.counts.free_pasters ?? "–"}
          icon={HardHat}
          accent="success"
          delay={0.04}
        />
        <KpiCard
          label="Free helpers"
          value={data?.counts.free_helpers ?? "–"}
          icon={Users}
          accent="info"
          delay={0.08}
        />
        <KpiCard
          label="Free drivers"
          value={data?.counts.free_drivers ?? "–"}
          icon={Truck}
          accent="orange"
          delay={0.12}
        />
        <KpiCard
          label="Double-booked"
          value={data?.counts.double_booked ?? "–"}
          icon={AlertTriangle}
          accent="warning"
          delay={0.16}
        />
        <KpiCard
          label="On leave"
          value={data?.counts.on_leave ?? "–"}
          icon={CalendarOff}
          accent="info"
          delay={0.2}
        />
      </div>

      {doubled.length > 0 && (
        <div
          className={cn(
            "mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm",
            stale,
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            {doubled.map((p, i) => (
              <span key={p.id}>
                {i > 0 && "; "}
                <span className="font-medium">{p.name}</span> is on{" "}
                {p.jobs.map((j) => j.order_no).join(" and ")}
              </span>
            ))}
            . Both jobs allow a 2nd job, so this was booked on purpose.
          </span>
        </div>
      )}

      <div
        aria-busy={isPlaceholderData}
        className={cn("grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]", stale)}
      >
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Jobs on this day
          </h2>
          {isLoading ? (
            <LoadingState label="Loading the day's jobs…" />
          ) : error && !data ? (
            <ErrorState title="Couldn't load the board" error={error} onRetry={() => refetch()} />
          ) : (data?.jobs ?? []).length === 0 ? (
            <EmptyState icon={LayoutGrid} title="No jobs on this day" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {data!.jobs.map((j) => (
                <article key={j.id} className="surface-panel grid gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      disabled={!JOB_EDITABLE.includes(j.status)}
                      onClick={() => setDialog({ job: j })}
                    >
                      <div className="font-mono text-sm font-semibold enabled:hover:underline">
                        {j.order?.order_no ?? "No order"} · {j.label}
                      </div>
                      {j.order && (
                        <div className="truncate text-xs text-muted-foreground">
                          {j.order.order_no} · {j.order.client_name}
                        </div>
                      )}
                    </button>
                    <JobStatusMenu job={j} />
                  </div>
                  <p className="line-clamp-2 text-sm">{j.work_details}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {jobPlace(j) ?? "Location not set"} <LocalityTag locality={j.locality} />
                    </span>
                    <span>
                      {formatJobDates(j.start_date, j.end_date)} ({j.days}d)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {j.members.map((m) => (
                      <span
                        key={m.user_id}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                      >
                        <span className="font-semibold text-muted-foreground">
                          {m.slot_role[0]}
                        </span>{" "}
                        {m.name}
                        {m.phone && (
                          <a
                            href={`tel:${m.phone}`}
                            aria-label={`Call ${m.name}`}
                            className="text-primary"
                          >
                            <Phone className="h-3 w-3" />
                          </a>
                        )}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Free on this day
          </h2>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            {ROLES.map((r) => {
              const people = data?.free[r] ?? [];
              return (
                <div key={r} className="surface-panel p-3">
                  <div className="mb-2 flex items-center justify-between text-sm font-medium">
                    {FIELD_ROLE_LABELS[r]}s{" "}
                    <span className="rounded-full bg-success/15 px-2 text-xs text-success">
                      {people.length}
                    </span>
                  </div>
                  {people.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Everyone is booked.</div>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {people.map((p) => (
                        <li key={p.id} className="rounded-full border px-2 py-0.5 text-xs">
                          {p.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            On leave
          </h2>
          <div className="surface-panel p-3">
            {(data?.on_leave ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground">Nobody is on leave.</div>
            ) : (
              <ul className="grid gap-2">
                {data!.on_leave.map((p) => (
                  <li key={p.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatJobDates(p.leave.from_date, p.leave.to_date)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {FIELD_ROLE_LABELS[p.role]}
                      {p.leave.reason ? ` · ${p.leave.reason}` : ""}
                    </div>
                    {p.jobs.length > 0 && (
                      <div className="mt-0.5 flex items-start gap-1 text-xs text-destructive">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        Still on {p.jobs.map((j) => j.order_no).join(", ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <JobDialog
        open={!!dialog}
        job={dialog?.job}
        defaultDate={date}
        onClose={() => setDialog(null)}
      />
    </>
  );
}
