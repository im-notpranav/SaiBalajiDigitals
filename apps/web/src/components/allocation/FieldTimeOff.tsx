import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, CalendarPlus, ChevronRight, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  OT_STATUS_LABELS,
  apiErrorMessage,
  fetchMyLeave,
  fetchMyOvertime,
  formatJobDates,
  formatMinutes,
  requestMyLeave,
  todayIST,
  withdrawMyLeave,
  type LeaveState,
  type OvertimeStatus,
} from "@/api/allocation";

/**
 * A field worker's own leave and overtime: the request form, the lists, and the summary
 * strip that sits at the top of their dashboard so leave is never more than one tap away.
 */

const leaveStateLabel: Record<LeaveState, string> = {
  PENDING: "Waiting for approval",
  REJECTED: "Not approved",
  CURRENT: "On leave now",
  UPCOMING: "Approved",
  PAST: "Taken",
  CANCELLED: "Cancelled",
};

const leaveStateStyle: Record<LeaveState, string> = {
  PENDING: "bg-warning/15 text-warning-foreground dark:text-warning",
  REJECTED: "bg-destructive/10 text-destructive",
  CURRENT: "bg-primary/10 text-primary",
  UPCOMING: "bg-success/10 text-success",
  PAST: "bg-muted text-muted-foreground",
  CANCELLED: "bg-muted text-muted-foreground",
};

const otStyles: Record<OvertimeStatus, string> = {
  PENDING: "bg-warning/15 text-warning-foreground dark:text-warning",
  APPROVED: "bg-success/10 text-success",
  REJECTED: "bg-muted text-muted-foreground line-through",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Request leave" with its own dialog, so any screen can offer it. */
export function RequestLeaveButton({
  className,
  ...props
}: Omit<ButtonProps, "onClick" | "children">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className={cn("rounded-xl", className)} onClick={() => setOpen(true)} {...props}>
        <CalendarPlus className="mr-1.5 h-4 w-4" /> Request leave
      </Button>
      <RequestLeaveDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The top-of-dashboard strip: where the person's leave stands, this month's overtime, and
 * the request button. Both summaries open the full Leave & overtime page.
 */
export function TimeOffSummary() {
  const { data: leaveData } = useQuery({ queryKey: ["my", "leave"], queryFn: fetchMyLeave });
  const { data: ot } = useQuery({ queryKey: ["my", "overtime"], queryFn: fetchMyOvertime });
  const leave = leaveData?.leave ?? [];

  const pending = leave.filter((l) => l.state === "PENDING").length;
  const now = leave.find((l) => l.state === "CURRENT");
  const next = leave
    .filter((l) => l.state === "UPCOMING")
    .sort((a, b) => a.from_date.localeCompare(b.from_date))[0];
  const leaveLine = !leaveData
    ? "…"
    : now
      ? `On leave until ${formatJobDates(now.to_date, now.to_date)}`
      : pending > 0
        ? `${plural(pending, "request")} waiting`
        : next
          ? `Approved: ${formatJobDates(next.from_date, next.to_date)}`
          : "None booked";

  const approved = ot?.month_approved_minutes ?? 0;
  const waiting = ot?.month_pending_minutes ?? 0;
  const otLine = !ot
    ? "…"
    : `${formatMinutes(approved)}${waiting > 0 ? ` · ${formatMinutes(waiting)} waiting` : ""}`;

  return (
    <section
      aria-label="Leave and overtime"
      className="surface-panel mb-6 grid gap-3 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
    >
      <div className="grid grid-cols-2 gap-2 sm:contents">
        <SummaryLink icon={CalendarOff} label="My leave" value={leaveLine} alert={pending > 0} />
        <SummaryLink icon={Clock} label="Overtime this month" value={otLine} />
      </div>
      <RequestLeaveButton className="h-11 w-full sm:w-auto" />
    </section>
  );
}

function SummaryLink({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <Link
      to="/field/leave"
      className="group flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-accent"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
          alert && "bg-warning/15 text-warning-foreground dark:text-warning",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block break-words text-sm font-semibold">{value}</span>
      </span>
      <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}

export function MyLeave() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my", "leave"],
    queryFn: fetchMyLeave,
  });
  const leave = data?.leave ?? [];
  const withdraw = useMutation({
    mutationFn: (id: number) => withdrawMyLeave(id),
    onSuccess: () => {
      toast.success("Leave request withdrawn");
      qc.invalidateQueries({ queryKey: ["my", "leave"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not withdraw the request")),
  });
  return (
    <section aria-labelledby="my-leave-heading">
      <h2
        id="my-leave-heading"
        className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
      >
        My leave
      </h2>
      <div className="surface-panel p-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading your leave…</div>
        ) : isError ? (
          <div className="text-sm text-destructive">Could not load your leave. Try again shortly.</div>
        ) : leave.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No leave yet. Tap “Request leave” to ask the Operations Manager.
          </div>
        ) : (
          <ul className="divide-y">
            {leave.map((l) => (
              <li
                key={l.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {formatJobDates(l.from_date, l.to_date)}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {plural(l.days, "day")}
                    </span>
                  </div>
                  {l.reason && <div className="text-xs text-muted-foreground">{l.reason}</div>}
                  {l.reject_reason && (
                    <div className="text-xs text-destructive">Reason: {l.reject_reason}</div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      leaveStateStyle[l.state],
                    )}
                  >
                    {leaveStateLabel[l.state]}
                  </span>
                  {l.state === "PENDING" && (
                    <button
                      type="button"
                      className="-mr-2 min-h-9 px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(l.id)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Ask for leave. It shows as waiting until the Operations Manager approves or rejects it. */
export function RequestLeaveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const today = todayIST();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setFrom(today);
    setTo(today);
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const save = useMutation({
    mutationFn: () => requestMyLeave({ from_date: from, to_date: to, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Leave requested. The Operations Manager will approve or reject it.");
      qc.invalidateQueries({ queryKey: ["my", "leave"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send the request")),
  });

  const valid = !!from && from >= today && to >= from && reason.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            The Operations Manager is told and approves or rejects it. You will get a
            notification either way.
          </DialogDescription>
        </DialogHeader>
        <form
          id="my-leave-form"
          className="grid gap-4 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !save.isPending) save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="my-leave-from">From</Label>
              <Input
                id="my-leave-from"
                type="date"
                value={from}
                min={today}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="my-leave-to">To</Label>
              <Input
                id="my-leave-to"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="my-leave-reason">Reason</Label>
            <Textarea
              id="my-leave-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Family function in my village"
            />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="my-leave-form" disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MyOvertime() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my", "overtime"],
    queryFn: fetchMyOvertime,
  });
  const entries = data?.entries ?? [];
  return (
    <section aria-labelledby="my-ot-heading">
      <h2
        id="my-ot-heading"
        className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
      >
        My overtime
      </h2>
      <div className="surface-panel p-4">
        <dl className="mb-3 grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Approved this month</dt>
            <dd className="text-lg font-bold tabular-nums">
              {formatMinutes(data?.month_approved_minutes ?? 0)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Waiting for approval</dt>
            <dd className="text-lg font-bold tabular-nums">
              {formatMinutes(data?.month_pending_minutes ?? 0)}
            </dd>
          </div>
        </dl>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading your overtime…</div>
        ) : isError ? (
          <div className="text-sm text-destructive">Could not load your overtime.</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">No overtime in the last two months.</div>
        ) : (
          <ul className="divide-y">
            {entries.slice(0, 10).map((o) => (
              <li
                key={o.id}
                className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="font-medium">{formatJobDates(o.work_date, o.work_date)}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">
                      {o.start_time}–{o.end_time}
                      {o.past_midnight ? " (+1)" : ""}
                    </span>
                    {o.order_no && <> · {o.order_no}</>}
                  </div>
                  {o.reject_reason && (
                    <div className="text-xs text-destructive">{o.reject_reason}</div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{o.duration}</span>
                  <span
                    className={cn("rounded-full px-2 py-0.5 text-xs font-medium", otStyles[o.status])}
                  >
                    {OT_STATUS_LABELS[o.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
