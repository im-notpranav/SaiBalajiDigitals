import { OrderNotesButton } from "@/components/orders/OrderNotes";

import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  Phone,
  PlayCircle,
  Store,
  Users,
  PauseCircle,
  XCircle,
  Ban,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
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
import { TimeOffSummary } from "@/components/allocation/FieldTimeOff";
import { DashboardGuide } from "@/components/dashboard/DashboardBits";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { useAuth } from "@/lib/auth-store";
import { roleLabel } from "@/lib/constants";
import {
  FIELD_ROLE_LABELS,
  apiErrorMessage,
  fetchMyJobs,
  formatJobDates,
  jobPlace,
  setMyJobStatus,
  todayIST,
  FIELD_FLAG_LABEL,
  type FieldJobFlag,
  type MyJob,
} from "@/api/allocation";

/** What the team can raise on a job, each with a reason; the job waits on hold for the OM. */
const FLAG_CHOICES: { flag: FieldJobFlag; label: string; icon: typeof PauseCircle; hint: string }[] = [
  { flag: "HOLD", label: "Hold", icon: PauseCircle, hint: "Can't carry on for now, e.g. store closed" },
  { flag: "CANCELLED", label: "Cancel", icon: XCircle, hint: "The work is no longer wanted" },
  { flag: "REJECTED", label: "Reject", icon: Ban, hint: "The job can't be done as given, e.g. wrong address" },
];

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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my", "work-jobs"],
    queryFn: fetchMyJobs,
    refetchInterval: 120_000,
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

      <DashboardGuide title="How this page works">
        <p>
          <strong>Today</strong> shows your work for today. Tap <strong>Start job</strong> when you begin, and{" "}
          <strong>Mark completed</strong> when you finish. The CSM and the Operations Manager are told straight away.
        </p>
        <p>
          <strong>Coming up</strong> shows your next jobs. You can start a job from its first day.
        </p>
        <p>
          <strong>Call</strong> rings the CSM or a teammate on that job. Use the top strip to ask for leave or check your
          overtime.
        </p>
      </DashboardGuide>

      {!user?.phone && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Your WhatsApp number is missing, so job alerts can't reach you. Ask the Operations Manager to add it.
          </span>
        </div>
      )}

      {/* Leave sits above the job list: with dozens of upcoming jobs a section after them
          is effectively out of reach on a phone. */}
      <TimeOffSummary />

      {isLoading ? (
        <LoadingState label="Loading your jobs…" />
      ) : isError && !data ? (
        <ErrorState title="Couldn't load your jobs" error={error} onRetry={() => refetch()} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No jobs assigned to you yet"
          description="Your work, with CSM, location, team and vehicle."
        />
      ) : (
        <div className="grid gap-6">
          <JobGroup title="Today" jobs={current} empty="Nothing for today." highlight />
          {/* A long run of future jobs is cut to the next few so today's work and the
              rest of the page stay within a thumb's reach. */}
          {upcoming.length > 0 && <JobGroup title="Coming up" jobs={upcoming} limit={4} />}
          {past.length > 0 && <JobGroup title="Last two weeks" jobs={past} muted limit={2} />}
        </div>
      )}
    </>
  );
}

function JobGroup({
  title,
  jobs,
  empty,
  highlight,
  muted,
  limit,
}: {
  title: string;
  jobs: MyJob[];
  empty?: string;
  highlight?: boolean;
  muted?: boolean;
  /** Show only the first few until the person asks for the rest. */
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = limit && !showAll ? jobs.slice(0, limit) : jobs;
  const hidden = jobs.length - shown.length;
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {jobs.length > 0 && (
          <span className="font-medium normal-case tracking-normal tabular-nums">
            {jobs.length}
          </span>
        )}
      </h2>
      {jobs.length === 0 ? (
        <div className="surface-panel p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((j) => (
            <JobCard key={j.id} job={j} highlight={highlight} muted={muted} />
          ))}
        </div>
      )}
      {!!limit && jobs.length > limit && (
        <Button
          variant="outline"
          className="mt-3 h-11 w-full rounded-xl"
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll ? "Show fewer" : `Show ${hidden} more`}
        </Button>
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
          <div className="font-mono text-sm font-semibold">
            {job.order?.order_no ?? "Order to be confirmed"}
          </div>
          {job.order && (
            <div className="truncate text-xs text-muted-foreground" title={job.order.client_name}>
              {job.order.client_name}
            </div>
          )}

        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <JobStatusBadge status={job.status} flag={job.field_flag} flagReason={job.field_flag_reason} />
          {job.order && (
            <OrderNotesButton orderId={job.order.id} orderNo={job.order.order_no} count={job.order.notes_count} size="sm" className="h-7 px-2 text-xs" />
          )}
        </div>
      </div>

      <p className="text-sm font-medium">{job.work_details ?? "Work details to follow"}</p>

      <dl className="grid gap-2 text-sm">
        <Row icon={CalendarDays}>
          {formatJobDates(job.start_date, job.end_date)} · {job.days} day{job.days === 1 ? "" : "s"}
        </Row>
        <Row icon={MapPin}>
          <span className="flex items-center gap-1.5">
            {jobPlace(job) ?? "Location to be confirmed"} <LocalityTag locality={job.locality} />
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
 * day; completing needs the job started. Hold, Cancel and Reject each take a reason and put
 * the job on hold for the Operations Manager to decide.
 */
function JobActions({ job }: { job: MyJob }) {
  const qc = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [flagging, setFlagging] = useState<FieldJobFlag | null>(null);
  const [note, setNote] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const today = todayIST();

  const mutation = useMutation({
    mutationFn: (v: { status: "STARTED" | "COMPLETED" | FieldJobFlag; note?: string }) =>
      setMyJobStatus(job.id, v.status, v.note),
    onSuccess: (saved, v) => {
      const on = saved.order ? ` on ${saved.order.order_no}` : "";
      toast.success(
        v.status === "STARTED"
          ? `Job${on} started`
          : v.status === "COMPLETED"
            ? `Job${on} marked completed`
            : `${FIELD_FLAG_LABEL[v.status]} sent${on}`,
        v.status !== "STARTED" && v.status !== "COMPLETED" ? { description: "The Operations Manager decides what happens next." } : undefined,
      );
      setCompleting(false);
      setFlagging(null);
      setNote("");
      setFlagNote("");
      qc.invalidateQueries({ queryKey: ["my", "work-jobs"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the job")),
  });
  const canFlag = job.status === "ASSIGNED" || job.status === "STARTED" || (job.status === "HOLD" && !job.field_flag);
  const picked = FLAG_CHOICES.find((c) => c.flag === flagging);

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

      {job.sent_back_reason && job.status !== "COMPLETED" && (
        <div className="flex items-start gap-1.5 rounded-lg bg-blue-500/10 px-2.5 py-1.5 text-xs text-blue-700 dark:text-blue-300">
          <RotateCcw className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Sent back by the CSM{job.sent_back_count && job.sent_back_count > 1 ? ` (${job.sent_back_count} times)` : ""}: {job.sent_back_reason}
          </span>
        </div>
      )}

      {job.status === "HOLD" && (
        <div className="text-xs text-warning-foreground">
          {job.field_flag ? (
            <>
              <span className="font-semibold">{FIELD_FLAG_LABEL[job.field_flag]} asked:</span> {job.field_flag_reason}. Waiting for the Operations Manager.
            </>
          ) : (
            "On hold. Wait for the Operations Manager before carrying on."
          )}
        </div>
      )}

      {canFlag && (
        <div className="grid grid-cols-3 gap-2">
          {FLAG_CHOICES.map((c) => (
            <Button key={c.flag} variant="outline" size="sm" className="h-9 rounded-xl text-xs" onClick={() => { setFlagNote(""); setFlagging(c.flag); }}>
              <c.icon className="mr-1 h-3.5 w-3.5" /> {c.label}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={!!flagging} onOpenChange={(o) => !o && setFlagging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {picked?.label} the job{job.order ? ` on ${job.order.order_no}` : ""}?
            </DialogTitle>
            <DialogDescription>{picked?.hint}. The job goes on hold and the Operations Manager decides.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`flag-note-${job.id}`}>Reason *</Label>
            <Textarea
              id={`flag-note-${job.id}`}
              rows={3}
              maxLength={500}
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
              placeholder="What happened?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagging(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending || flagNote.trim().length < 3}
              onClick={() => flagging && mutation.mutate({ status: flagging, note: flagNote.trim() })}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send {picked?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mark the job{job.order ? ` on ${job.order.order_no}` : ""} completed?
            </DialogTitle>
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
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-primary transition-colors active:bg-accent"
    >
      <Phone className="h-4 w-4" />
    </a>
  );
}
