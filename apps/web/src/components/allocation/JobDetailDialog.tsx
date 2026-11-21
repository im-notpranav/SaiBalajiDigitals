import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import {
  FIELD_ROLE_LABELS,
  JOB_EDITABLE,
  fetchCsmJobDetails,
  fetchJobDetails,
  formatJobDates,
  jobPlace,
  type FieldRole,
  type WorkJob,
} from "@/api/allocation";
import { JobStatusBadge, JobStatusMenu, LocalityTag, MineTag, jobOwnerName } from "./JobBits";

const ROLES: FieldRole[] = ["PASTER", "HELPER", "DRIVER"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * A job and what its order asks for, opened from the grid, the board or the dashboard. Rates
 * and amounts are not shown here, and the API does not send them.
 *
 * In "csm" mode a CSM reads any job; on his own (`mine`) the edit button lets him update the
 * work details or link his order, and on anyone else's it says whose job it is.
 */
export function JobDetailDialog({
  jobId,
  onClose,
  onEdit,
  mode = "manage",
}: {
  jobId: number | null;
  onClose: () => void;
  /** Without it there is no edit button. */
  onEdit?: (job: WorkJob) => void;
  mode?: "manage" | "csm";
}) {
  const csm = mode === "csm";
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: csm ? ["csm-jobs", "details", jobId] : ["work-jobs", "details", jobId],
    queryFn: () => (csm ? fetchCsmJobDetails(jobId!) : fetchJobDetails(jobId!)),
    enabled: jobId !== null,
  });
  const job = data?.job;
  const covered = new Set(job?.stores.map((s) => s.id));
  const editable = !!job && JOB_EDITABLE.includes(job.status) && (!csm || !!job.mine);

  return (
    <Dialog open={jobId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words font-mono">
            {job ? (job.order?.order_no ?? "No order yet") : "Job details"}
          </DialogTitle>
          <DialogDescription className="break-words">
            {job?.order?.client_name ?? "This job has not been linked to an order."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          // Roughly the height of a loaded job, so the dialog does not open small and then
          // jump in size while its opening animation is still running.
          <LoadingState bare className="min-h-[18rem]" />
        ) : !job ? (
          <ErrorState bare title="Couldn't load this job" error={error} onRetry={() => refetch()} />
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {csm ? <JobStatusBadge status={job.status} flag={job.field_flag} flagReason={job.field_flag_reason} /> : <JobStatusMenu job={job} />}
              {csm && job.mine && <MineTag />}
            </div>
            <dl className="grid gap-1.5 rounded-xl border p-3">
              <Row label="Dates">
                {formatJobDates(job.start_date, job.end_date)} · {job.days} day
                {job.days === 1 ? "" : "s"}
              </Row>
              <Row label="CSM">{job.csm?.name ?? "Not set"}</Row>
              <Row label="Location">
                <span className="flex items-center gap-1.5">
                  {jobPlace(job) ?? "Not set"} <LocalityTag locality={job.locality} />
                </span>
              </Row>
              {/* Any number of each role, or nobody yet: only the roles on the job are listed. */}
              {job.members.length === 0 ? (
                <Row label="Team">No team yet</Row>
              ) : (
                ROLES.map((r) => {
                  const names = job.members.filter((m) => m.slot_role === r).map((m) => m.name);
                  return names.length ? (
                    <Row key={r} label={`${FIELD_ROLE_LABELS[r]}${names.length > 1 ? "s" : ""}`}>
                      {names.join(", ")}
                    </Row>
                  ) : null;
                })
              )}
              <Row label="Work details">{job.work_details ?? "To follow"}</Row>
              {job.route && <Row label="Route">{job.route}</Row>}
              {job.instructions && <Row label="Instructions">{job.instructions}</Row>}
            </dl>

            {data!.order_stores.length > 0 && (
              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Order details</h3>
                {data!.order_stores.map((s) => (
                  <div key={s.id} className="overflow-x-auto rounded-xl border">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
                      <span className="min-w-0 break-words font-medium">
                        {s.s_no}. {s.store_name}
                        {s.location && (
                          <span className="font-normal text-muted-foreground"> · {s.location}</span>
                        )}
                      </span>
                      {covered.has(s.id) && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                          On this job
                        </span>
                      )}
                    </div>
                    {s.items.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No items yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="px-3 py-1.5 font-medium">Media</th>
                            <th className="px-3 py-1.5 font-medium">Size (inches)</th>
                            <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                            <th className="px-3 py-1.5 text-right font-medium">SFT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.map((i) => (
                            <tr key={i.id} className="border-t">
                              <td className="px-3 py-1.5">{i.media}</td>
                              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                                {i.width_inches} × {i.height_inches}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{i.qty}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{i.total_sft}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:gap-2">
          {job && csm && !job.mine ? (
            <p className="mr-auto text-xs text-muted-foreground">
              This job belongs to {jobOwnerName(job)}.
            </p>
          ) : (
            job &&
            !JOB_EDITABLE.includes(job.status) && (
              <p className="mr-auto text-xs text-muted-foreground">
                {job.status === "CANCELLED"
                  ? "A cancelled job cannot be changed."
                  : csm
                    ? "A completed job cannot be changed."
                    : "Reopen this job to change it."}
              </p>
            )
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {job && editable && onEdit && (
            <Button onClick={() => onEdit(job)}>
              <Pencil className="mr-2 h-4 w-4" />
              {csm ? "Update job" : "Edit team and work details"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
