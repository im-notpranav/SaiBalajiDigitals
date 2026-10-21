import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FIELD_ROLE_LABELS,
  JOB_STATUS_LABELS,
  addDays,
  fetchDailyBoard,
  fetchWorkJobs,
  todayIST,
  type FieldRole,
  type WorkJobStatus,
} from "@/api/allocation";

const STATUSES: WorkJobStatus[] = ["ASSIGNED", "STARTED", "HOLD", "COMPLETED"];
const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];

/**
 * The dashboard's view of work allocation: today's free people, and where this week's jobs
 * stand. Every number comes from the same jobs the Weekly Grid shows.
 */
export function AllocationOverviewCard() {
  const today = todayIST();
  const weekEnd = addDays(today, 6);
  const { data: board } = useQuery({
    queryKey: ["work-jobs", "board", today],
    queryFn: () => fetchDailyBoard(today),
  });
  const { data: week } = useQuery({
    queryKey: ["work-jobs", "list", { from: today, to: weekEnd }],
    queryFn: () => fetchWorkJobs({ from: today, to: weekEnd }),
  });
  const jobs = (week?.jobs ?? []).filter((j) => j.status !== "CANCELLED");
  const byStatus = (s: WorkJobStatus) => jobs.filter((j) => j.status === s).length;
  const free: Record<FieldRole, number> | null = board
    ? {
        PASTER: board.counts.free_pasters,
        HELPER: board.counts.free_helpers,
        DRIVER: board.counts.free_drivers,
      }
    : null;

  return (
    <section className="surface-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarRange className="h-4 w-4 text-primary" /> Work allocation
        </h3>
        <Link to="/admin/grid" className="text-sm font-medium text-primary hover:underline">
          Open Weekly Grid
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Today
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Jobs" value={board?.counts.jobs} />
            {ROLES.map((r) => (
              <Stat
                key={r}
                label={`Free ${FIELD_ROLE_LABELS[r].toLowerCase()}s`}
                value={free?.[r]}
                warn={free?.[r] === 0}
              />
            ))}
          </div>
          {!!board?.counts.double_booked && (
            <p className="mt-2 text-xs font-medium text-destructive">
              {board.counts.double_booked} double-booked today
            </p>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Next 7 days · {jobs.length} job{jobs.length === 1 ? "" : "s"}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STATUSES.map((s) => (
              <Stat key={s} label={JOB_STATUS_LABELS[s]} value={week ? byStatus(s) : undefined} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value?: number; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border px-3 py-2">
      <div className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </div>
      <div
        className={cn("text-xl font-semibold tabular-nums", warn && "text-destructive")}
        aria-live="polite"
      >
        {value ?? "–"}
      </div>
    </div>
  );
}
