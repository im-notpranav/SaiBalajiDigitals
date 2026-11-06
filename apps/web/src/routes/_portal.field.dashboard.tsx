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
  type MyJob,
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

      {!user?.phone && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Your WhatsApp number is missing. Add it on your Profile page so you receive job alerts.
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
          description="When the Operations Manager assigns you work, it shows up here with the CSM, location, team and vehicle."
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
        <JobStatusBadge status={job.status} />
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
      const on = saved.order ? ` on ${saved.order.order_no}` : "";
      toast.success(saved.status === "STARTED" ? `Job${on} started` : `Job${on} marked completed`);
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
