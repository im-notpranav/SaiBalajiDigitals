import { AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TIMER_OWNER_LABELS,
  formatWhen,
  type PaymentTimer,
  type TimerKind,
} from "@/api/payments";

/**
 * Overdue timers on payment requests. Each condition a request waits on counts working days
 * (Sundays off); past the Admin's limit it turns red and bold, and it disappears as soon as
 * the condition is resolved, because the server works timers out afresh on every read.
 */

export const TIMER_KIND_LABELS: Record<TimerKind, string> = {
  ADMIN_REVIEW: "Admin approval",
  CCM_REVIEW: "Cost Control review",
  REPLY: "Requester's reply",
  PAYMENT: "Payment",
  CLOSE: "Closing",
  BILL: "Bill",
};

export const workingDays = (n: number) => `${n} working ${n === 1 ? "day" : "days"}`;

/** Red and bold once overdue: for request numbers and day counts. */
export const overdueText = (overdue: boolean) => (overdue ? "font-bold text-destructive" : "");

/** One small chip per timer, e.g. "Cost Control review · 12d". */
export function TimerChips({ timers, className }: { timers: PaymentTimer[]; className?: string }) {
  if (!timers.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {timers.map((t) => (
        <span
          key={t.kind}
          title={`${t.label} for ${workingDays(t.days)}${t.overdue ? " (overdue)" : ""}`}
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]",
            t.overdue
              ? "border-destructive/40 bg-destructive/10 font-bold text-destructive"
              : "border-border text-muted-foreground",
          )}
        >
          {t.overdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {t.short} · {t.days}d
        </span>
      ))}
    </div>
  );
}

/** The request sheet's account of what it is waiting on, on whom, and since when. */
export function TimerList({ timers }: { timers: PaymentTimer[] }) {
  if (!timers.length) return null;
  return (
    <div className="surface-panel grid gap-3 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Waiting on
      </div>
      {timers.map((t) => (
        <div key={t.kind} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <div className={cn("flex items-center gap-1.5", overdueText(t.overdue))}>
              {t.overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
              {t.label}
            </div>
            <div className="text-xs text-muted-foreground">
              {TIMER_OWNER_LABELS[t.owner]} · since {formatWhen(t.since)}
            </div>
          </div>
          <div
            className={cn(
              "shrink-0 text-right tabular-nums",
              t.overdue ? overdueText(true) : "text-muted-foreground",
            )}
          >
            {workingDays(t.days)}
            {t.overdue && <div className="text-[11px] uppercase tracking-wide">Overdue</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
