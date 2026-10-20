import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { cellStyles } from "@/components/allocation/JobBits";
import {
  FIELD_ROLE_LABELS,
  JOB_EDITABLE,
  JOB_STATUS_LABELS,
  addDays,
  apiErrorMessage,
  fetchWeeklyGrid,
  fetchWorkJob,
  todayIST,
  type FieldRole,
  type WorkJob,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/grid")({
  head: () => ({ meta: [{ title: "Weekly Grid — SB OMS" }] }),
  component: WeeklyGridPage,
});

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];

/**
 * The old WAS sheet: one row per person, one column per day, each cell showing the job
 * label (order/CSM code, -N_ for non-local, then the tag). Click a job to edit it, or an
 * empty cell to start a job for that person on that day.
 */
function WeeklyGridPage() {
  const today = todayIST();
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState(7);
  const [dialog, setDialog] = useState<{
    job: WorkJob | null;
    date?: string;
    members?: number[];
  } | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["work-jobs", "grid", from, days],
    queryFn: () => fetchWeeklyGrid(from, days),
  });

  const openJob = async (id: number) => {
    setOpening(id);
    try {
      const job = await fetchWorkJob(id);
      if (!JOB_EDITABLE.includes(job.status)) {
        toast.info(
          `${job.job_no} is ${JOB_STATUS_LABELS[job.status].toLowerCase()}. Reopen it from Field Jobs to change it.`,
        );
        return;
      }
      setDialog({ job });
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not open the job"));
    } finally {
      setOpening(null);
    }
  };

  const dates = data?.dates ?? [];
  const head = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    return {
      day: dt.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
      date: dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
      sunday: dt.getUTCDay() === 0,
    };
  };

  return (
    <>
      <PageHeader
        title="Weekly Grid"
        description="Who is where, day by day. NL marks non-local work; a red cell means the person is on two jobs that day."
        crumbs={[{ label: "Work Allocation" }, { label: "Weekly Grid" }]}
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Earlier"
          onClick={() => setFrom(addDays(from, -days))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
          className="w-44"
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Later"
          onClick={() => setFrom(addDays(from, days))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {from !== today && (
          <Button variant="ghost" onClick={() => setFrom(today)}>
            Today
          </Button>
        )}
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32 sm:ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="14">14 days</SelectItem>
            <SelectItem value="31">31 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="surface-panel overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-10 min-w-[11rem] border-b bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Person
                </th>
                {dates.map((d) => {
                  const h = head(d);
                  return (
                    <th
                      key={d}
                      className={cn(
                        "min-w-[7.5rem] border-b border-l px-2 py-2 text-center text-xs font-medium",
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
              {ROLES.map((role) => {
                const rows = (data?.rows ?? []).filter((r) => r.role === role);
                if (rows.length === 0) return null;
                return (
                  <Fragment key={role}>
                    <tr>
                      <td
                        colSpan={dates.length + 1}
                        className="sticky left-0 border-b bg-background px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {FIELD_ROLE_LABELS[role]}s
                      </td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.id} className="group">
                        <td className="sticky left-0 z-10 border-b bg-card px-3 py-1.5 group-hover:bg-muted">
                          <div className="truncate font-medium">{r.name}</div>
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
                                className="h-8 w-full rounded-md text-xs text-transparent transition-colors hover:bg-muted hover:text-muted-foreground"
                                onClick={() =>
                                  setDialog({ job: null, date: dates[i], members: [r.id] })
                                }
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
                                  <button
                                    key={c.job_id}
                                    type="button"
                                    title={`${c.job_no} · ${JOB_STATUS_LABELS[c.status]}`}
                                    className={cn(
                                      "flex items-center justify-center gap-1 truncate rounded-md border px-1.5 py-1 font-mono text-[11px] font-semibold",
                                      cellStyles[c.status],
                                    )}
                                    onClick={() => openJob(c.job_id)}
                                  >
                                    {opening === c.job_id && (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    )}
                                    {c.label}
                                  </button>
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
              {(data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={dates.length + 1} className="p-8 text-center text-muted-foreground">
                    No active field staff yet. Add them under Field Staff.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              {ROLES.map((role) => (
                <tr key={role} className="bg-muted/30 text-xs">
                  <td className="sticky left-0 z-10 border-t bg-muted px-3 py-1.5 font-medium text-muted-foreground">
                    Free {FIELD_ROLE_LABELS[role].toLowerCase()}s
                  </td>
                  {(data?.free ?? []).map((f, i) => (
                    <td
                      key={dates[i]}
                      className={cn(
                        "border-l border-t px-2 py-1.5 text-center font-semibold tabular-nums",
                        f[role] === 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {f[role]}
                    </td>
                  ))}
                </tr>
              ))}
            </tfoot>
          </table>
        )}
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
