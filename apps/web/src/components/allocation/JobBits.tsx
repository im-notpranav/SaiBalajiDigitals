import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  FIELD_FLAG_LABEL,
  apiErrorMessage,
  sendBackJob,
  setWorkJobStatus,
  todayIST,
  type FieldJobFlag,
  type WorkJob,
  type WorkJobStatus,
} from "@/api/allocation";

/** Shared pieces of the work-allocation pages: status badge, status menu, locality tag, team words. */

const statusStyles: Record<WorkJobStatus, string> = {
  ASSIGNED: "bg-info/15 text-info border-info/30",
  STARTED: "bg-primary/15 text-primary border-primary/30",
  COMPLETED: "bg-success/15 text-success border-success/30",
  HOLD: "bg-warning/15 text-warning-foreground border-warning/30",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
};

export function JobStatusBadge({
  status,
  flag,
  flagReason,
  className,
}: {
  status: WorkJobStatus;
  /** The team asked to Hold, Cancel or Reject the job; it waits on hold for the OM. */
  flag?: FieldJobFlag | null;
  flagReason?: string | null;
  className?: string;
}) {
  const asked = status === "HOLD" && flag;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        asked ? "border-destructive/30 bg-destructive/10 text-destructive" : statusStyles[status],
        className,
      )}
      title={asked && flagReason ? `${FIELD_FLAG_LABEL[flag]} asked: ${flagReason}` : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {JOB_STATUS_LABELS[status]}
      {asked && <span className="font-semibold">· {FIELD_FLAG_LABEL[flag]} asked</span>}
    </span>
  );
}

/**
 * Send the team back to a completed job: same job, a new day, with the reason. The CSM uses
 * it on their own jobs; the Operations Manager and admin on any.
 */
export function SendBackButton({ job, asCsm, size = "sm" }: { job: WorkJob; asCsm: boolean; size?: "sm" | "default" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayIST());
  const mutation = useMutation({
    mutationFn: () => sendBackJob(job.id, { reason: reason.trim(), date }, asCsm),
    onSuccess: (saved) => {
      toast.success(`Team sent back${saved.order ? ` to ${saved.order.order_no}` : ""}`, { description: "The team and the Operations Manager are told." });
      setOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["work-jobs"] });
      qc.invalidateQueries({ queryKey: ["csm-jobs"] });
      qc.invalidateQueries({ queryKey: ["order"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send the team back")),
  });
  if (job.status !== "COMPLETED") return null;
  return (
    <>
      <Button type="button" variant="outline" size={size} className="h-7 gap-1 px-2 text-xs" onClick={() => { setDate(todayIST()); setOpen(true); }}>
        <RotateCcw className="h-3.5 w-3.5" /> Send back
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send the team back{job.order ? ` to ${job.order.order_no}` : ""}</DialogTitle>
            <DialogDescription>The same job reopens on the day you pick, with the same team.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`sb-reason-${job.id}`}>Reason *</Label>
              <Textarea id={`sb-reason-${job.id}`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Poster peeling at one store" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`sb-date-${job.id}`}>Day</Label>
              <Input id={`sb-date-${job.id}`} type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button disabled={mutation.isPending || reason.trim().length < 3 || !date} onClick={() => mutation.mutate()}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

  if (next.length === 0) return <JobStatusBadge status={job.status} flag={job.field_flag} flagReason={job.field_flag_reason} />;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={mutation.isPending}
          >
            <JobStatusBadge status={job.status} flag={job.field_flag} flagReason={job.field_flag_reason} />
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

/** "Abdul (P), Afzal (H), Umar (D)" — compact team line for tables. A job may have no team yet. */
export function teamLine(members: WorkJob["members"]): string {
  if (members.length === 0) return "No team yet";
  return members.map((m) => `${m.name} (${m.slot_role[0]})`).join(", ");
}

/** "Ravi", "Ravi +2", or "" — any number of people in the space of one name, for grid boxes. */
export function compactNames(names: string[]): string {
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? "");
}

/** Whose job this is, in words: its CSM, else the person or team behind its CSM code. */
export function jobOwnerName(job: Pick<WorkJob, "csm" | "csm_code">): string {
  return (
    job.csm?.name ??
    job.csm_code?.user?.name ??
    job.csm_code?.label ??
    job.csm_code?.code ??
    "another CSM"
  );
}

/** Marks a CSM's own job on the pages where he also sees every other CSM's. */
export function MineTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary",
        className,
      )}
    >
      Your job
    </span>
  );
}
