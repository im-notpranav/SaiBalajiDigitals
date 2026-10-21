import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  Phone,
  PlayCircle,
  Store,
  Truck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
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
import { JobStatusBadge, LocalityTag } from "@/components/allocation/JobBits";
import { useAuth } from "@/lib/auth-store";
import { roleLabel } from "@/lib/constants";
import {
  FIELD_ROLE_LABELS,
  OT_STATUS_LABELS,
  apiErrorMessage,
  fetchMyJobs,
  fetchMyLeave,
  fetchMyOvertime,
  formatJobDates,
  formatMinutes,
  requestMyLeave,
  setMyJobStatus,
  todayIST,
  withdrawMyLeave,
  type LeaveState,
  type MyJob,
  type OvertimeStatus,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/field/dashboard")({
  head: () => ({ meta: [{ title: "My Work — SB OMS" }] }),
  component: FieldDashboard,
});

/**
 * Home for Pasters, Helpers and Drivers, built for a phone: today's work first, then what
 * is coming up, then the last two weeks. Each job card has its own Start / Complete button.
 */
function FieldDashboard() {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "";
  const { data, isLoading } = useQuery({
    queryKey: ["my", "work-jobs"],
    queryFn: fetchMyJobs,
    refetchInterval: 60_000,
  });

  const today = data?.today ?? "";
  const jobs = data?.jobs ?? [];
  const current = jobs.filter((j) => j.start_date <= today && j.end_date >= today);
  const upcoming = jobs.filter((j) => j.start_date > today);
  const past = jobs.filter((j) => j.end_date < today).reverse();

  return (
    <>
      <PageHeader
        title={`Hi ${firstName}`}
        description={roleLabel(user?.role)}
        crumbs={[{ label: "My Work" }]}
      />

      {!user?.phone && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Your WhatsApp number is missing. Add it on your Profile page so you receive job alerts.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="surface-panel p-8 text-center text-muted-foreground">
          Loading your jobs…
        </div>
      ) : jobs.length === 0 ? (
        <div className="surface-panel flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold">No jobs assigned to you yet</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            When the Operations Manager assigns you work, it shows up here with the CSM, location,
            team and vehicle.
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          <JobGroup title="Today" jobs={current} empty="Nothing for today." highlight />
          {upcoming.length > 0 && <JobGroup title="Coming up" jobs={upcoming} />}
          {past.length > 0 && <JobGroup title="Last two weeks" jobs={past} muted />}
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <MyLeave />
        <MyOvertime />
      </div>
    </>
  );
}

const leaveStateLabel: Record<LeaveState, string> = {
  PENDING: "Waiting for approval",
  REJECTED: "Not approved",
  CURRENT: "On leave now",
  UPCOMING: "Approved",
  PAST: "Taken",
  CANCELLED: "Cancelled",
};

const leaveStateStyle: Partial<Record<LeaveState, string>> = {
  PENDING: "text-warning-foreground font-medium",
  REJECTED: "text-destructive",
  CURRENT: "text-destructive",
  UPCOMING: "text-success font-medium",
};

function MyLeave() {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const { data } = useQuery({ queryKey: ["my", "leave"], queryFn: fetchMyLeave });
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
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          My leave
        </h2>
        <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setAsking(true)}>
          <CalendarPlus className="mr-1.5 h-4 w-4" /> Request leave
        </Button>
      </div>
      <div className="surface-panel p-4">
        {leave.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No leave yet. Tap “Request leave” to ask the Operations Manager.
          </div>
        ) : (
          <ul className="grid gap-3">
            {leave.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{formatJobDates(l.from_date, l.to_date)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {l.days} day{l.days === 1 ? "" : "s"}
                  </span>
                  {l.reason && (
                    <span className="block text-xs text-muted-foreground">{l.reason}</span>
                  )}
                  {l.reject_reason && (
                    <span className="block text-xs text-destructive">
                      Reason: {l.reject_reason}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("text-xs text-muted-foreground", leaveStateStyle[l.state])}>
                    {leaveStateLabel[l.state]}
                  </span>
                  {l.state === "PENDING" && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(l.id)}
                    >
                      Withdraw
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <RequestLeaveDialog open={asking} onClose={() => setAsking(false)} />
    </section>
  );
}

/** Ask for leave. It shows as waiting until the Operations Manager approves or rejects it. */
function RequestLeaveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <div className="grid gap-4 py-1">
          <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const otStyles: Record<OvertimeStatus, string> = {
  PENDING: "text-warning-foreground",
  APPROVED: "text-success",
  REJECTED: "text-muted-foreground line-through",
};

function MyOvertime() {
  const { data } = useQuery({ queryKey: ["my", "overtime"], queryFn: fetchMyOvertime });
  const entries = data?.entries ?? [];
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        My overtime
      </h2>
      <div className="surface-panel p-4">
        <div className="mb-3 flex gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Approved this month</div>
            <div className="text-lg font-bold tabular-nums">
              {formatMinutes(data?.month_approved_minutes ?? 0)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Waiting for approval</div>
            <div className="text-lg font-bold tabular-nums">
              {formatMinutes(data?.month_pending_minutes ?? 0)}
            </div>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">No overtime in the last two months.</div>
        ) : (
          <ul className="grid gap-2">
            {entries.slice(0, 10).map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{formatJobDates(o.work_date, o.work_date)}</span>{" "}
                  <span className="font-mono text-xs">
                    {o.start_time}–{o.end_time}
                    {o.past_midnight ? " (+1)" : ""}
                  </span>
                  {o.order_no && (
                    <span className="text-xs text-muted-foreground"> · {o.order_no}</span>
                  )}
                  {o.reject_reason && (
                    <span className="block text-xs text-destructive">{o.reject_reason}</span>
                  )}
                </span>
                <span className={cn("shrink-0 text-xs font-medium", otStyles[o.status])}>
                  {o.duration} · {OT_STATUS_LABELS[o.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function JobGroup({
  title,
  jobs,
  empty,
  highlight,
  muted,
}: {
  title: string;
  jobs: MyJob[];
  empty?: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {jobs.length === 0 ? (
        <div className="surface-panel p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} highlight={highlight} muted={muted} />
          ))}
        </div>
      )}
    </section>
  );
}

function JobCard({ job, highlight, muted }: { job: MyJob; highlight?: boolean; muted?: boolean }) {
  const { user } = useAuth();
  const team = job.members.filter((m) => m.user_id !== user?.id);
  return (
    <article
      className={cn(
        "surface-panel grid gap-3 p-4",
        highlight && "ring-1 ring-primary/30",
        muted && "opacity-75",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold">{job.order.order_no}</div>
          <div className="truncate text-xs text-muted-foreground" title={job.order.client_name}>
            {job.order.client_name}
          </div>
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      <p className="text-sm font-medium">{job.work_details}</p>

      <dl className="grid gap-2 text-sm">
        <Row icon={CalendarDays}>
          {formatJobDates(job.start_date, job.end_date)} · {job.days} day{job.days === 1 ? "" : "s"}
        </Row>
        <Row icon={MapPin}>
          <span className="flex items-center gap-1.5">
            {job.area.name} <LocalityTag locality={job.locality} />
          </span>
          {job.route && <span className="block text-xs text-muted-foreground">{job.route}</span>}
        </Row>
        {job.stores.length > 0 && (
          <Row icon={Store}>
            {job.stores.map((s) => (
              <span key={s.id} className="block">
                {s.store_name}
                {s.location ? (
                  <span className="text-xs text-muted-foreground"> · {s.location}</span>
                ) : null}
              </span>
            ))}
          </Row>
        )}
        {team.length > 0 && (
          <Row icon={Users}>
            {team.map((m) => (
              <span key={m.user_id} className="flex items-center justify-between gap-2">
                <span>
                  {m.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {FIELD_ROLE_LABELS[m.slot_role]}
                  </span>
                </span>
                {m.phone && <CallLink phone={m.phone} name={m.name} />}
              </span>
            ))}
          </Row>
        )}
        {job.vehicle && (
          <Row icon={Truck}>
            {job.vehicle.reg_no} · {job.vehicle.type}
          </Row>
        )}
      </dl>

      {job.instructions && <p className="rounded-lg bg-muted/50 p-2 text-sm">{job.instructions}</p>}

      {job.csm && (
        <div className="flex items-center justify-between gap-2 rounded-xl border p-2.5">
          <div className="min-w-0 text-sm">
            <div className="text-xs text-muted-foreground">CSM for this job</div>
            <div className="truncate font-medium">{job.csm.name}</div>
          </div>
          {job.csm.phone && (
            <a
              href={`tel:${job.csm.phone}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
        </div>
      )}

      <JobActions job={job} />
    </article>
  );
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

/**
 * Start / complete buttons for the person's own job. Starting opens on the job's first
 * day; completing needs the job started. Hold, cancel and reopen stay with managers.
 */
function JobActions({ job }: { job: MyJob }) {
  const qc = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState("");
  const today = todayIST();

  const mutation = useMutation({
    mutationFn: (v: { status: "STARTED" | "COMPLETED"; note?: string }) =>
      setMyJobStatus(job.id, v.status, v.note),
    onSuccess: (saved) => {
      toast.success(
        saved.status === "STARTED"
          ? `Job on ${saved.order.order_no} started`
          : `Job on ${saved.order.order_no} marked completed`,
      );
      setCompleting(false);
      setNote("");
      qc.invalidateQueries({ queryKey: ["my", "work-jobs"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the job")),
  });

  return (
    <div className="grid gap-2 border-t pt-3">
      {job.started_at && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PlayCircle className="h-3.5 w-3.5" /> Started {fmtTime(job.started_at)}
          {job.started_by ? ` by ${job.started_by.name}` : ""}
        </div>
      )}
      {job.completed_at && (
        <div className="flex items-start gap-1.5 text-xs text-success">
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Completed {fmtTime(job.completed_at)}
            {job.completed_by ? ` by ${job.completed_by.name}` : ""}
            {job.completion_note && (
              <span className="block text-muted-foreground">“{job.completion_note}”</span>
            )}
          </span>
        </div>
      )}

      {job.status === "ASSIGNED" &&
        (job.start_date <= today ? (
          <Button
            className="h-11 w-full rounded-xl text-base"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ status: "STARTED" })}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-5 w-5" />
            )}
            Start job
          </Button>
        ) : (
          <div className="text-xs text-muted-foreground">
            You can start this job from {formatJobDates(job.start_date, job.start_date)}.
          </div>
        ))}

      {job.status === "STARTED" && (
        <Button
          className="h-11 w-full rounded-xl bg-success text-base text-white hover:bg-success/90"
          onClick={() => setCompleting(true)}
        >
          <CheckCircle2 className="mr-2 h-5 w-5" /> Mark completed
        </Button>
      )}

      {job.status === "HOLD" && (
        <div className="text-xs text-warning-foreground">
          On hold. Wait for the Operations Manager before carrying on.
        </div>
      )}

      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark the job on {job.order.order_no} completed?</DialogTitle>
            <DialogDescription>
              The CSM and the Operations Manager are told straight away.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`done-note-${job.id}`}>
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={`done-note-${job.id}`}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. All boards fixed; one store asked for a revisit"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleting(false)}>
              Not yet
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ status: "COMPLETED", note: note.trim() || undefined })
              }
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark completed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function CallLink({ phone, name }: { phone: string; name: string }) {
  return (
    <a
      href={`tel:${phone}`}
      aria-label={`Call ${name}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border text-primary"
    >
      <Phone className="h-3.5 w-3.5" />
    </a>
  );
}
