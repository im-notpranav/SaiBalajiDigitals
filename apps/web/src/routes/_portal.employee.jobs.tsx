import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, HardHat, MapPin, Pencil, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { JobStatusBadge, SendBackButton } from "@/components/allocation/JobBits";
import { CsmJobEditDialog } from "@/components/allocation/CsmJobEditDialog";
import {
  JOB_EDITABLE,
  fetchCsmJobs,
  formatJobDates,
  jobPlace,
  type WorkJob,
} from "@/api/allocation";

export const Route = createFileRoute("/_portal/employee/jobs")({
  head: () => ({ meta: [{ title: "Field Jobs — SB OMS" }] }),
  component: CsmJobsPage,
});

/** The field jobs a CSM is responsible for: they add the work details and link the order. */
function CsmJobsPage() {
  const [editing, setEditing] = useState<WorkJob | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["csm-jobs"],
    queryFn: fetchCsmJobs,
  });

  return (
    <>
      <PageHeader
        title="Field Jobs"
        description="Jobs assigned to you. Add details or link the order."
        crumbs={[{ label: "Field Jobs" }]}
      />
      {isLoading ? (
        <LoadingState label="Loading your jobs…" />
      ) : !data ? (
        <ErrorState title="Couldn't load your jobs" error={error} onRetry={() => refetch()} />
      ) : data.jobs.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No field jobs"
          description="Jobs assigned for you will show here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.jobs.map((j) => (
            <JobCard key={j.id} job={j} onEdit={() => setEditing(j)} />
          ))}
        </div>
      )}
      <CsmJobEditDialog job={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function JobCard({ job, onEdit }: { job: WorkJob; onEdit: () => void }) {
  return (
    <article className="surface-panel grid content-start gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono font-semibold">{job.order?.order_no ?? "No order yet"}</div>
          {job.order && (
            <div className="truncate text-xs text-muted-foreground" title={job.order.client_name}>
              {job.order.client_name}
            </div>
          )}
        </div>
        <JobStatusBadge status={job.status} flag={job.field_flag} flagReason={job.field_flag_reason} />
      </div>
      <p className="break-words text-sm">
        {job.work_details ?? <span className="text-muted-foreground">No work details yet.</span>}
      </p>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" />
          {formatJobDates(job.start_date, job.end_date)}
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" />
          {jobPlace(job) ?? "Location not set"}
        </div>
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">
            {job.members.length ? job.members.map((m) => m.name).join(", ") : "No team yet"}
          </span>
        </div>
      </dl>
      {job.status === "HOLD" && job.field_flag_reason && <p className="text-xs text-destructive">Team says: {job.field_flag_reason}</p>}
      {JOB_EDITABLE.includes(job.status) && (
        <div>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={onEdit}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Update job
          </Button>
        </div>
      )}
      {job.status === "COMPLETED" && (
        <div>
          <SendBackButton job={job} asCsm />
        </div>
      )}
    </article>
  );
}
