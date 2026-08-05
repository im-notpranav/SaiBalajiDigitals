/**
 * Turnaround (TAT) helpers — derive an order's current pipeline stage and how long
 * it has been sitting there. "Overdue" (Phase 6) means stuck at the current stage
 * beyond a threshold. Closed orders have no current stage.
 *
 * Requires the order loaded with items and each item's assignments.
 */

const DAY = 86400000;

/** Count business days between two dates, excluding Sundays. */
export function businessDaysBetween(from: Date, to: Date): number {
  const start = new Date(from);
  const end = new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end <= start) return 0;

  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0) count++; // 0 = Sunday
  }
  return count;
}

export const daysSince = (from: Date | string | null | undefined, to: Date = new Date()): number | null =>
  from == null ? null : businessDaysBetween(new Date(from), to);

/** Latest moment any line item finished production (order fully produced). */
export function lastProducedAt(order: any): Date | null {
  const times = (order.items ?? [])
    .map((i: any) => i.production_completed_at)
    .filter(Boolean)
    .map((d: any) => new Date(d).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

export interface StageInfo {
  stage: string;
  since: Date;
  days_in_stage: number;
}

/**
 * The stage an open order is currently waiting in, and when it entered it.
 * Returns null for closed orders (PaymentReceived / Completed).
 */
export function currentStage(order: any): StageInfo | null {
  const status = order.status;
  if (status === "PaymentReceived" || status === "Completed") return null;

  const items = order.items ?? [];
  const assignedItems = items.filter((i: any) => (i.assignments?.length ?? 0) > 0);
  const hasProduction = assignedItems.length > 0;

  let stage: string;
  let since: Date;

  if (status === "BillingCompleted") {
    stage = "Awaiting payment";
    since = order.billing_completed_at ?? order.updated_at ?? order.created_at;
  } else if (status === "Pending") {
    stage = "Pending (billing / payment)";
    since = order.billing_completed_at ?? order.updated_at ?? order.created_at;
  } else if (status === "Installed") {
    stage = "Awaiting billing";
    since = order.installed_at ?? order.updated_at ?? order.created_at;
  } else {
    // Active
    if (!hasProduction) {
      stage = "Unassigned / ready to bill";
      since = order.created_at;
    } else if (assignedItems.every((i: any) => i.production_completed)) {
      stage = "Awaiting installation";
      since = lastProducedAt(order) ?? order.created_at;
    } else {
      stage = "In production";
      const times = assignedItems
        .flatMap((i: any) => i.assignments ?? [])
        .map((a: any) => a.assigned_at)
        .filter(Boolean)
        .map((d: any) => new Date(d).getTime());
      since = times.length ? new Date(Math.max(...times)) : order.created_at;
    }
  }

  const sinceDate = new Date(since);
  return { stage, since: sinceDate, days_in_stage: daysSince(sinceDate)! };
}
