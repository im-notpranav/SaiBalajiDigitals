import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, Inbox, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StaffSelect } from "@/components/allocation/StaffSelect";
import { JobStatusBadge } from "@/components/allocation/JobBits";
import {
  FIELD_ROLE_LABELS,
  addDays,
  apiErrorMessage,
  cancelLeave,
  createLeave,
  decideLeave,
  fetchLeave,
  formatJobDates,
  todayIST,
  updateLeave,
  type LeaveJobClash,
  type LeaveRecord,
  type LeaveState,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/admin/leave")({
  head: () => ({ meta: [{ title: "Leave — SB OMS" }] }),
  component: LeavePage,
});

const stateStyles: Record<LeaveState, string> = {
  PENDING: "bg-warning/15 text-warning-foreground border-warning/30",
  REJECTED: "bg-muted text-muted-foreground border-border line-through",
  CURRENT: "bg-destructive/10 text-destructive border-destructive/30",
  UPCOMING: "bg-info/15 text-info border-info/30",
  PAST: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
};
const stateLabels: Record<LeaveState, string> = {
  PENDING: "Waiting for approval",
  REJECTED: "Rejected",
  CURRENT: "On leave now",
  UPCOMING: "Upcoming",
  PAST: "Past",
  CANCELLED: "Cancelled",
};

/**
 * The leave register. Field staff request leave from their dashboard and it waits here for
 * approval; leave recorded here is approved at once. Approved leave blocks allocation:
 * nobody on leave can be put on a job.
 */
function LeavePage() {
  const today = todayIST();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, 60));
  const [person, setPerson] = useState<number | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [editing, setEditing] = useState<{ leave: LeaveRecord | null } | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRecord | null>(null);
  const [rejecting, setRejecting] = useState<LeaveRecord | null>(null);
  const [approvingOver, setApprovingOver] = useState<{
    leave: LeaveRecord;
    jobs: LeaveJobClash[];
  } | null>(null);
  const qc = useQueryClient();

  const { data: pendingData } = useQuery({
    queryKey: ["leave", "pending"],
    queryFn: () => fetchLeave({ status: "PENDING" }),
    refetchInterval: 60_000,
  });
  const pending = pendingData?.leave ?? [];

  const approve = useMutation({
    mutationFn: (v: { leave: LeaveRecord; acknowledge: boolean }) =>
      decideLeave(v.leave.id, { status: "APPROVED", acknowledge_jobs: v.acknowledge }),
    onSuccess: (saved) => {
      toast.success(`Leave approved for ${saved.user.name}`);
      setApprovingOver(null);
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
    },
    onError: (err: unknown, v) => {
      const data = (err as { response?: { data?: { job_conflicts?: unknown } } })?.response?.data;
      if (Array.isArray(data?.job_conflicts)) {
        setApprovingOver({ leave: v.leave, jobs: data.job_conflicts as LeaveJobClash[] });
        return;
      }
      toast.error(apiErrorMessage(err, "Could not approve the leave"));
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
  });

  const filters = {
    from,
    to,
    user_id: person ? String(person) : undefined,
    include_cancelled: showCancelled,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["leave", "list", filters],
    queryFn: () => fetchLeave(filters),
  });
  const rows = data?.leave ?? [];

  return (
    <>
      <PageHeader
        title="Leave"
        description="Field staff request leave from their dashboard; approve or reject it here. Approved leave blocks allocation, even with “Allow 2nd job”."
        crumbs={[{ label: "Work Allocation" }, { label: "Leave" }]}
        actions={
          <Button className="rounded-xl" onClick={() => setEditing({ leave: null })}>
            <Plus className="mr-2 h-4 w-4" /> Record leave
          </Button>
        }
      />

      {pending.length > 0 && (
        <section className="surface-panel mb-4 border-warning/40 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Inbox className="h-4 w-4 text-warning-foreground" />
            Waiting for approval
            <span className="rounded-full bg-warning/20 px-2 text-xs tabular-nums">
              {pending.length}
            </span>
          </h2>
          <ul className="divide-y">
            {pending.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="font-medium">{l.user.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {FIELD_ROLE_LABELS[l.user.role]}
                    </span>
                  </div>
                  <div className="text-sm">
                    {formatJobDates(l.from_date, l.to_date)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {l.days} day{l.days === 1 ? "" : "s"}
                      {l.from_date < today ? " · dates already passed" : ""}
                    </span>
                  </div>
                  {l.reason && <div className="text-xs text-muted-foreground">“{l.reason}”</div>}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate({ leave: l, acknowledge: false })}
                  >
                    <Check className="mr-1.5 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(l)}>
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <label className="flex h-10 items-center gap-2 text-sm">
          <Switch checked={showCancelled} onCheckedChange={setShowCancelled} /> Show cancelled
          and rejected
        </label>
      </div>

      <div className="surface-panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Person</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested / decided</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="p-8 text-center text-muted-foreground">
                  No leave in this window.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((l) => (
                <TableRow
                  key={l.id}
                  className={l.state === "CANCELLED" || l.state === "REJECTED" ? "opacity-60" : ""}
                >
                  <TableCell>
                    <div className="font-medium">{l.user.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {FIELD_ROLE_LABELS[l.user.role]}
                      {l.user.emp_code ? ` · ${l.user.emp_code}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div>{formatJobDates(l.from_date, l.to_date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.days} day{l.days === 1 ? "" : "s"}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <div className="line-clamp-2 text-sm">{l.reason || "—"}</div>
                    {l.reject_reason && (
                      <div className="text-xs text-destructive">Rejected: {l.reject_reason}</div>
                    )}
                    {l.cancel_reason && (
                      <div className="text-xs text-muted-foreground">
                        Cancelled: {l.cancel_reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        stateStyles[l.state],
                      )}
                    >
                      {stateLabels[l.state]}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div>
                      {l.requested ? "Requested by them" : `Recorded by ${l.creator?.name ?? "—"}`}
                    </div>
                    {l.requested && l.decider && (
                      <div className="text-xs">
                        {l.status === "APPROVED" ? "Approved" : "Rejected"} by {l.decider.name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {l.state === "PENDING" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Approve leave for ${l.user.name}`}
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ leave: l, acknowledge: false })}
                        >
                          <Check className="h-4 w-4 text-success" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Reject leave for ${l.user.name}`}
                          onClick={() => setRejecting(l)}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                    {l.state !== "CANCELLED" && l.state !== "REJECTED" && l.state !== "PENDING" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit leave for ${l.user.name}`}
                          onClick={() => setEditing({ leave: l })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Cancel leave for ${l.user.name}`}
                          onClick={() => setCancelling(l)}
                        >
                          <Ban className="h-4 w-4 text-destructive" />
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

      <LeaveDialog
        open={!!editing}
        leave={editing?.leave ?? null}
        onClose={() => setEditing(null)}
      />
      <CancelLeaveDialog leave={cancelling} onClose={() => setCancelling(null)} />
      <RejectLeaveDialog leave={rejecting} onClose={() => setRejecting(null)} />

      <Dialog open={!!approvingOver} onOpenChange={(o) => !o && setApprovingOver(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Already on jobs over these dates</DialogTitle>
            <DialogDescription>
              {approvingOver &&
                `${approvingOver.leave.user.name} asked for ${formatJobDates(approvingOver.leave.from_date, approvingOver.leave.to_date)}.`}
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5 text-sm">
            {approvingOver?.jobs.map((j) => (
              <li key={j.job_id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{j.order_no}</span>
                <span>{formatJobDates(j.start_date, j.end_date)}</span>
                <JobStatusBadge status={j.status} />
                <span className="text-muted-foreground">{j.work_details}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Better: take them off those jobs in Field Jobs first. Approving anyway keeps them on
            the jobs and flags them on the Daily Board.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovingOver(null)}>
              Not yet
            </Button>
            <Button
              disabled={approve.isPending}
              onClick={() => approve.mutate({ leave: approvingOver!.leave, acknowledge: true })}
            >
              {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RejectLeaveDialog({ leave, onClose }: { leave: LeaveRecord | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [leave]);
  const mutation = useMutation({
    mutationFn: () => decideLeave(leave!.id, { status: "REJECTED", reason: reason.trim() }),
    onSuccess: (saved) => {
      toast.success(`Leave rejected for ${saved.user.name}`);
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not reject the leave"));
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
  });
  return (
    <Dialog open={!!leave} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this leave request?</DialogTitle>
          <DialogDescription>
            {leave &&
              `${leave.user.name}, ${formatJobDates(leave.from_date, leave.to_date)}. They are told, with this reason.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="leave-reject-reason">Reason</Label>
          <Textarea
            id="leave-reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Big installation that week; please pick other dates"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 2 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({
  open,
  leave,
  onClose,
}: {
  open: boolean;
  leave: LeaveRecord | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const today = todayIST();
  const [userId, setUserId] = useState<number | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [jobClashes, setJobClashes] = useState<LeaveJobClash[]>([]);

  useEffect(() => {
    if (!open) return;
    setUserId(leave?.user.id ?? null);
    setFrom(leave?.from_date ?? today);
    setTo(leave?.to_date ?? today);
    setReason(leave?.reason ?? "");
    setJobClashes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, leave]);

  const save = useMutation({
    mutationFn: (acknowledge: boolean) => {
      const body = {
        user_id: userId!,
        from_date: from,
        to_date: to,
        reason: reason.trim() || null,
        acknowledge_jobs: acknowledge,
      };
      return leave ? updateLeave(leave.id, body) : createLeave(body);
    },
    onSuccess: (saved) => {
      toast.success(`Leave saved for ${saved.user.name}`);
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
      onClose();
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { job_conflicts?: unknown } } })?.response?.data;
      setJobClashes(
        Array.isArray(data?.job_conflicts) ? (data.job_conflicts as LeaveJobClash[]) : [],
      );
      toast.error(apiErrorMessage(err, "Could not save the leave"));
    },
  });

  const valid = !!userId && !!from && (!to || to >= from);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{leave ? `Edit leave · ${leave.user.name}` : "Record leave"}</DialogTitle>
          <DialogDescription>
            The person is told, and cannot be put on jobs over these days.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label>Person</Label>
            <StaffSelect
              value={userId}
              onChange={(id) => {
                setUserId(id);
                setJobClashes([]);
              }}
              disabled={!!leave}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="leave-from">From</Label>
              <Input
                id="leave-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                  setJobClashes([]);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leave-to">To</Label>
              <Input
                id="leave-to"
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setJobClashes([]);
                }}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leave-reason">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="leave-reason"
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {jobClashes.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-amber-700 dark:text-amber-500">
                <AlertTriangle className="h-4 w-4" /> Already on jobs over these dates
              </div>
              <ul className="mb-3 grid gap-1.5">
                {jobClashes.map((j) => (
                  <li key={j.job_id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{j.order_no}</span>
                    <span>{formatJobDates(j.start_date, j.end_date)}</span>
                    <JobStatusBadge status={j.status} />
                    <span className="text-muted-foreground">{j.work_details}</span>
                  </li>
                ))}
              </ul>
              <p className="mb-2 text-xs text-muted-foreground">
                Better: take them off those jobs in Field Jobs first. Saving anyway keeps them on
                the jobs and flags them on the Daily Board.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() => save.mutate(true)}
              >
                Save leave anyway
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate(false)}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelLeaveDialog({ leave, onClose }: { leave: LeaveRecord | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [leave]);
  const mutation = useMutation({
    mutationFn: () => cancelLeave(leave!.id, reason.trim()),
    onSuccess: () => {
      toast.success("Leave cancelled");
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not cancel the leave")),
  });
  return (
    <Dialog open={!!leave} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel leave?</DialogTitle>
          <DialogDescription>
            {leave &&
              `${leave.user.name}, ${formatJobDates(leave.from_date, leave.to_date)}. They become available for jobs again and are told.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="leave-cancel-reason">Reason</Label>
          <Textarea
            id="leave-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Came back early"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep leave
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 2 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
