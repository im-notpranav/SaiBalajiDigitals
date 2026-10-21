import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Search } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobDialog } from "@/components/allocation/JobDialog";
import { JobStatusMenu, LocalityTag, teamLine } from "@/components/allocation/JobBits";
import {
  JOB_EDITABLE,
  JOB_STATUS_LABELS,
  addDays,
  fetchWorkJobs,
  formatJobDates,
  todayIST,
  type WorkJob,
  type WorkJobStatus,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/jobs")({
  head: () => ({ meta: [{ title: "Field Jobs — SB OMS" }] }),
  component: JobsPage,
});

const OPEN = "ASSIGNED,STARTED,HOLD";
const ALL = "__all__";

/** Every field job in a date window: the Operation Manager's replacement for the Task Log sheet. */
function JobsPage() {
  const today = todayIST();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(addDays(today, 14));
  const [status, setStatus] = useState(OPEN);
  const [locality, setLocality] = useState(ALL);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dialog, setDialog] = useState<{ job: WorkJob | null } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters = {
    from,
    to,
    status: status === ALL ? undefined : status,
    locality: locality === ALL ? undefined : locality,
    q: debouncedQ || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["work-jobs", "list", filters],
    queryFn: () => fetchWorkJobs(filters),
  });
  const jobs = data?.jobs ?? [];

  return (
    <>
      <PageHeader
        title="Field Jobs"
        description="Assign installation work to Pasters, Helpers and Drivers. Nobody can be double-booked unless the job allows a 2nd job."
        crumbs={[{ label: "Work Allocation" }, { label: "Field Jobs" }]}
        actions={
          <Button className="rounded-xl" onClick={() => setDialog({ job: null })}>
            <Plus className="mr-2 h-4 w-4" /> New job
          </Button>
        }
      />

      <div className="surface-panel mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] lg:items-end">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order no, client or work"
            className="pl-9"
          />
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="lg:w-40"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
            className="lg:w-40"
          />
        </label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="lg:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPEN}>Open jobs</SelectItem>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(JOB_STATUS_LABELS) as WorkJobStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {JOB_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={locality} onValueChange={setLocality}>
          <SelectTrigger className="lg:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Local + NL</SelectItem>
            <SelectItem value="LOCAL">Local only</SelectItem>
            <SelectItem value="NON_LOCAL">Non-local only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="surface-panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Order</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Work</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="p-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-8 text-center text-muted-foreground">
                  No jobs in this window. Use “New job” to assign one.
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((j) => (
                <TableRow key={j.id} className={j.status === "CANCELLED" ? "opacity-60" : ""}>
                  <TableCell>
                    <div className="whitespace-nowrap font-mono font-semibold">
                      {j.order.order_no}
                    </div>
                    <div
                      className="max-w-[12rem] truncate text-xs text-muted-foreground"
                      title={j.order.client_name}
                    >
                      {j.order.client_name}
                    </div>
                    <div className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {j.label}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div>{formatJobDates(j.start_date, j.end_date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {j.days} day{j.days === 1 ? "" : "s"}
                      {j.allow_double_booking ? " · 2nd job" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <div className="line-clamp-2 text-sm">{j.work_details}</div>
                    {j.stores.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {j.stores.length} store{j.stores.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      {j.area.name} <LocalityTag locality={j.locality} />
                    </div>
                    {j.vehicle && (
                      <div className="text-xs text-muted-foreground">{j.vehicle.reg_no}</div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-sm">
                    <div className="line-clamp-2">{teamLine(j.members)}</div>
                  </TableCell>
                  <TableCell>
                    <JobStatusMenu job={j} />
                    {j.status === "COMPLETED" && j.completed_by && (
                      <div
                        className="mt-1 max-w-[10rem] truncate text-xs text-muted-foreground"
                        title={j.completion_note ?? undefined}
                      >
                        Done by {j.completed_by.name}
                      </div>
                    )}
                    {j.status === "STARTED" && j.started_by && (
                      <div className="mt-1 max-w-[10rem] truncate text-xs text-muted-foreground">
                        Started by {j.started_by.name}
                      </div>
                    )}
                    {j.cancel_reason && (
                      <div
                        className="mt-1 max-w-[10rem] truncate text-xs text-muted-foreground"
                        title={j.cancel_reason}
                      >
                        {j.cancel_reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit the job on ${j.order.order_no}`}
                      disabled={!JOB_EDITABLE.includes(j.status)}
                      onClick={() => setDialog({ job: j })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {jobs.length >= 500 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the first 500 jobs. Narrow the dates or filters to see the rest.
        </p>
      )}

      <JobDialog open={!!dialog} job={dialog?.job} onClose={() => setDialog(null)} />
    </>
  );
}
