import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  JOB_STATUS_LABELS,
  JOB_STATUS_NEXT,
  apiErrorMessage,
  setWorkJobStatus,
  type WorkJob,
  type WorkJobStatus,
} from "@/api/allocation";

/** Shared pieces of the work-allocation pages: status badge, status menu, locality tag. */

const statusStyles: Record<WorkJobStatus, string> = {
  ASSIGNED: "bg-info/15 text-info border-info/30",
  STARTED: "bg-primary/15 text-primary border-primary/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  HOLD: "bg-warning/15 text-warning-foreground border-warning/30",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
};

export function JobStatusBadge({
  status,
  className,
}: {
  status: WorkJobStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}

/** Grid / board cell colour for a job in a given status. */
export const cellStyles: Record<WorkJobStatus, string> = {
  ASSIGNED: "bg-info/10 text-info border-info/30 hover:bg-info/20",
  STARTED: "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20",
  COMPLETED: "bg-success/10 text-success border-success/30 hover:bg-success/20",
  HOLD: "bg-warning/15 text-warning-foreground border-warning/40 hover:bg-warning/25",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function LocalityTag({ locality }: { locality: "LOCAL" | "NON_LOCAL" | null }) {
  return locality === "NON_LOCAL" ? (
    <span className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-orange">
      NL
    </span>
  ) : null;
}

const actionLabels: Record<WorkJobStatus, string> = {
  ASSIGNED: "Back to assigned",
  STARTED: "Mark started",
  COMPLETED: "Mark completed",
  HOLD: "Put on hold",
  CANCELLED: "Cancel job…",
};

/**
 * The job's status with a menu of the moves the API allows from it. Cancelling asks for a
 * reason first; reopening a completed job is labelled as such.
 */
export function JobStatusMenu({ job }: { job: WorkJob }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const next = JOB_STATUS_NEXT[job.status];

  const mutation = useMutation({
    mutationFn: ({ status, reason }: { status: WorkJobStatus; reason?: string }) =>
      setWorkJobStatus(job.id, status, reason),
    onSuccess: (updated) => {
      toast.success(
        `Job${updated.order ? ` on ${updated.order.order_no}` : ""} is now ${JOB_STATUS_LABELS[updated.status].toLowerCase()}`,
      );
      setCancelOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not change the status")),
  });

  if (next.length === 0) return <JobStatusBadge status={job.status} />;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={mutation.isPending}
          >
            <JobStatusBadge status={job.status} />
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {next.map((s) => (
            <DropdownMenuItem
              key={s}
              className={s === "CANCELLED" ? "text-destructive focus:text-destructive" : ""}
              onSelect={() =>
                s === "CANCELLED" ? setCancelOpen(true) : mutation.mutate({ status: s })
              }
            >
              {job.status === "COMPLETED" && s === "STARTED"
                ? "Reopen (back to started)"
                : actionLabels[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words">
              Cancel the job{job.order ? ` on ${job.order.order_no}` : ""}?
            </DialogTitle>
            <DialogDescription>
              The team is told and their dates become free. A cancelled job cannot be reopened.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client postponed the installation"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep job
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || mutation.isPending}
              onClick={() => mutation.mutate({ status: "CANCELLED", reason: reason.trim() })}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Abdul (P), Afzal (H), Umar (D)" — compact team line for tables. */
export function teamLine(members: WorkJob["members"]): string {
  return members.map((m) => `${m.name} (${m.slot_role[0]})`).join(", ");
}
