import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Moon, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { TableStateRow } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { StaffSelect } from "@/components/allocation/StaffSelect";
import {
  FIELD_ROLE_LABELS,
  OT_STATUS_LABELS,
  addDays,
  apiErrorMessage,
  createOvertime,
  decideOvertime,
  deleteOvertime,
  fetchCsmCodes,
  fetchOvertime,
  fetchWorkJobs,
  formatJobDates,
  formatMinutes,
  overtimeMinutes,
  todayIST,
  updateOvertime,
  type OvertimeEntry,
  type OvertimeStatus,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/overtime")({
  head: () => ({ meta: [{ title: "Overtime — SB OMS" }] }),
  component: OvertimePage,
});

const ALL = "__all__";
const NONE = "__none__";

const statusStyles: Record<OvertimeStatus, string> = {
  PENDING: "bg-warning/15 text-warning-foreground border-warning/30",
  APPROVED: "bg-success/15 text-success border-success/30",
  REJECTED: "bg-muted text-muted-foreground border-border line-through",
};

function OtStatusBadge({ status }: { status: OvertimeStatus }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status],
      )}
    >
      {OT_STATUS_LABELS[status]}
    </span>
  );
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/**
 * The overtime register. The Operation Manager or Admin logs it; only an Admin approves
 * or rejects, singly or in bulk. Hours run past midnight when the close is before the start.
 */
function OvertimePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const qc = useQueryClient();
  const today = todayIST();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<string>(ALL);
  const [person, setPerson] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<{ entry: OvertimeEntry | null } | null>(null);
  const [rejecting, setRejecting] = useState<number[] | null>(null);
  const [deleting, setDeleting] = useState<OvertimeEntry | null>(null);

  const filters = {
    from,
    to,
    status: status === ALL ? undefined : status,
    user_id: person ? String(person) : undefined,
  };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["overtime", "list", filters],
    queryFn: () => fetchOvertime(filters),
  });
  const entries = data?.entries ?? [];
  const pendingIds = entries.filter((e) => e.status === "PENDING").map((e) => e.id);
  useEffect(() => setSelected((s) => s.filter((id) => pendingIds.includes(id))), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = useMutation({
    mutationFn: ({
      ids,
      status,
      reason,
    }: {
      ids: number[];
      status: "APPROVED" | "REJECTED";
      reason?: string;
    }) => decideOvertime(ids, status, reason),
    onSuccess: (r, v) => {
      toast.success(
        `${r.entries.length} ${r.entries.length === 1 ? "entry" : "entries"} ${v.status === "APPROVED" ? "approved" : "rejected"}`,
      );
      setSelected([]);
      setRejecting(null);
      qc.invalidateQueries({ queryKey: ["overtime"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the decision")),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteOvertime(id),
    onSuccess: () => {
      toast.success("Entry deleted");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["overtime"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete the entry")),
  });

  const t = data?.totals;
  const allPendingSelected =
    pendingIds.length > 0 && pendingIds.every((id) => selected.includes(id));

  return (
    <>
      <PageHeader
        title="Overtime"
        description={
          isAdmin
            ? "Log overtime and approve or reject it."
            : "Log overtime. An Admin approves or rejects each entry."
        }
        crumbs={[{ label: "Work Allocation" }, { label: "Overtime" }]}
        actions={
          <Button className="rounded-xl" onClick={() => setEditing({ entry: null })}>
            <Plus className="mr-2 h-4 w-4" /> Log overtime
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Entries", t ? String(t.entries) : "–"],
          ["Waiting for approval", t ? String(t.pending) : "–"],
          ["Approved hours", t ? formatMinutes(t.approved_minutes) : "–"],
          ["Pending hours", t ? formatMinutes(t.pending_minutes) : "–"],
        ].map(([label, value]) => (
          <div key={label} className="surface-panel p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="surface-panel mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,16rem)_auto_auto_auto] lg:items-end">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Person
          <StaffSelect value={person} onChange={setPerson} allowAll />
        </label>
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
          <SelectTrigger className="lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(OT_STATUS_LABELS) as OvertimeStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {OT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isAdmin && selected.length > 0 && (
        <div className="surface-panel mb-3 flex flex-wrap items-center gap-2 border-primary/30 p-3 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          <Button
            size="sm"
            className="ml-auto"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ ids: selected, status: "APPROVED" })}
          >
            <Check className="mr-1.5 h-4 w-4" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => setRejecting(selected)}
          >
            <X className="mr-1.5 h-4 w-4" /> Reject…
          </Button>
        </div>
      )}

      <div className="surface-panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {isAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all pending"
                    checked={allPendingSelected}
                    disabled={pendingIds.length === 0}
                    onCheckedChange={(c) => setSelected(c ? pendingIds : [])}
                  />
                </TableHead>
              )}
              <TableHead>Date</TableHead>
              <TableHead>Person</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Job / CSM</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || (error && !data) || entries.length === 0 ? (
              <TableStateRow
                colSpan={9}
                loading={isLoading}
                error={error && !data ? error : undefined}
                onRetry={() => refetch()}
                empty={{ title: "No overtime in this window." }}
              />
            ) : (
              entries.map((e) => (
                <TableRow key={e.id} className={e.status === "REJECTED" ? "opacity-60" : ""}>
                  {isAdmin && (
                    <TableCell>
                      <Checkbox
                        aria-label={`Select entry for ${e.user.name}`}
                        disabled={e.status !== "PENDING"}
                        checked={selected.includes(e.id)}
                        onCheckedChange={(c) =>
                          setSelected((s) => (c ? [...s, e.id] : s.filter((x) => x !== e.id)))
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">{fmtDay(e.work_date)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{e.user.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {FIELD_ROLE_LABELS[e.user.role]}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-sm">
                    {e.start_time}–{e.end_time}
                    {e.past_midnight && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-muted px-1 font-sans text-[10px] text-muted-foreground"
                        title="Ran past midnight"
                      >
                        <Moon className="h-3 w-3" /> +1
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-semibold tabular-nums">
                    {e.duration}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.work_job ? (
                      <span className="font-mono">{e.work_job.order?.order_no ?? "No order"}</span>
                    ) : (
                      "—"
                    )}
                    {e.csm_code && (
                      <div className="text-xs text-muted-foreground">CSM {e.csm_code.code}</div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[14rem]">
                    <div className="line-clamp-2 text-sm">{e.remarks || "—"}</div>
                    {e.reject_reason && (
                      <div className="text-xs text-destructive">Rejected: {e.reject_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <OtStatusBadge status={e.status} />
                    {e.decider && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        by {e.decider.name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {e.status === "PENDING" && (
                      <>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Approve"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ ids: [e.id], status: "APPROVED" })}
                          >
                            <Check className="h-4 w-4 text-success" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit"
                          onClick={() => setEditing({ entry: e })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete"
                          onClick={() => setDeleting(e)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <OvertimeDialog
        open={!!editing}
        entry={editing?.entry ?? null}
        onClose={() => setEditing(null)}
      />

      <RejectDialog
        count={rejecting?.length ?? 0}
        open={!!rejecting}
        pending={decide.isPending}
        onClose={() => setRejecting(null)}
        onReject={(reason) => decide.mutate({ ids: rejecting!, status: "REJECTED", reason })}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              {deleting &&
                `${deleting.user.name}, ${fmtDay(deleting.work_date)} ${deleting.start_time}–${deleting.end_time}. The audit log keeps a copy.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting!.id)}
            >
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RejectDialog({
  open,
  count,
  pending,
  onClose,
  onReject,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Reject {count} {count === 1 ? "entry" : "entries"}?
          </DialogTitle>
          <DialogDescription>Each person is told, with this reason.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="ot-reject-reason">Reason</Label>
          <Textarea
            id="ot-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Not informed in advance"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || pending}
            onClick={() => onReject(reason.trim())}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Log overtime for one or more people at once, or edit one pending entry. */
function OvertimeDialog({
  open,
  entry,
  onClose,
}: {
  open: boolean;
  entry: OvertimeEntry | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const today = todayIST();
  const [userIds, setUserIds] = useState<number[]>([]);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("21:00");
  const [jobId, setJobId] = useState<number | null>(null);
  const [codeId, setCodeId] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setUserIds(entry ? [entry.user.id] : []);
    setDate(entry?.work_date ?? today);
    setStart(entry?.start_time ?? "18:00");
    setEnd(entry?.end_time ?? "21:00");
    setJobId(entry?.work_job?.id ?? null);
    setCodeId(entry?.csm_code?.id ?? null);
    setRemarks(entry?.remarks ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, entry]);

  // Jobs running that day that include everyone picked, to link the overtime to.
  const { data: jobData } = useQuery({
    queryKey: ["work-jobs", "list", { from: date, to: date }],
    queryFn: () => fetchWorkJobs({ from: date, to: date }),
    enabled: open && !!date,
  });
  const jobs = (jobData?.jobs ?? []).filter(
    (j) =>
      j.status !== "CANCELLED" &&
      userIds.length > 0 &&
      userIds.every((u) => j.members.some((m) => m.user_id === u)),
  );
  useEffect(() => {
    if (jobId && jobData && !jobs.some((j) => j.id === jobId)) setJobId(null);
  }, [jobData, userIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: codeData } = useQuery({
    queryKey: ["masters", "csm-codes"],
    queryFn: fetchCsmCodes,
    enabled: open,
  });
  const codes = (codeData?.codes ?? []).filter((c) => c.is_active || c.id === codeId);

  const minutes = overtimeMinutes(start, end);
  const pastMidnight = minutes !== null && end <= start;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        work_date: date,
        start_time: start,
        end_time: end,
        work_job_id: jobId,
        csm_code_id: codeId,
        remarks: remarks.trim() || null,
      };
      return entry
        ? updateOvertime(entry.id, { ...body, user_id: userIds[0] }).then(() => 1)
        : createOvertime({ ...body, user_ids: userIds }).then((r) => r.entries.length);
    },
    onSuccess: (n) => {
      toast.success(
        entry ? "Overtime updated" : `Overtime logged for ${n} ${n === 1 ? "person" : "people"}`,
      );
      qc.invalidateQueries({ queryKey: ["overtime"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the overtime")),
  });

  const valid = userIds.length > 0 && !!date && minutes !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? "Edit overtime" : "Log overtime"}</DialogTitle>
          <DialogDescription>
            {entry
              ? "Only pending entries can be changed."
              : "Pick everyone who worked the same hours; each gets their own entry."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label>{entry ? "Person" : "People"}</Label>
            {entry ? (
              <StaffSelect
                value={userIds[0] ?? null}
                onChange={(id) => setUserIds(id ? [id] : [])}
              />
            ) : (
              <StaffSelect
                values={userIds}
                onToggle={(id, on) =>
                  setUserIds((u) =>
                    on ? (u.length < 5 ? [...u, id] : u) : u.filter((x) => x !== id),
                  )
                }
                placeholder="Pick up to 5 people"
              />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="ot-date">Date</Label>
              <Input
                id="ot-date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ot-start">Start</Label>
              <Input
                id="ot-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ot-end">Close</Label>
              <Input id="ot-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div
            className={cn(
              "rounded-xl border p-3 text-sm",
              minutes === null ? "border-destructive/30 text-destructive" : "bg-muted/40",
            )}
          >
            {minutes === null
              ? "Start and close cannot be the same."
              : `${formatMinutes(minutes)}${pastMidnight ? ` — runs past midnight, closing on ${formatJobDates(addDays(date, 1), addDays(date, 1))}` : ""}`}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>
                Job <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={jobId ? String(jobId) : NONE}
                onValueChange={(v) => setJobId(v === NONE ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {jobs.length ? "No job" : "No shared job that day"}
                  </SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      {j.order?.order_no ?? "No order"} · {j.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>
                CSM code <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={codeId ? String(codeId) : NONE}
                onValueChange={(v) => setCodeId(v === NONE ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{jobId ? "From the job" : "None"}</SelectItem>
                  {codes.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code}
                      {c.user ? ` · ${c.user.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ot-remarks">
              Remarks <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="ot-remarks"
              rows={2}
              maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {entry ? "Save changes" : "Log overtime"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
