import { rollupOrder } from "./order-derive";
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

type ClosedOrder = Parameters<typeof rollupOrder>[0] & { status: string; created_at: Date; updated_at: Date };

/**
 * When a closed order closed. A fully paid order closes with its last payment. An order an
 * admin closed by hand has no such moment, since its payments may be older than the closure,
 * so it uses the last change to the order, which is normally the closure.
 */
export function closedAt(order: ClosedOrder): Date {
  const paidAt = order.status === "PaymentReceived" ? rollupOrder(order).payment_received_at : null;
  return new Date(paidAt ?? order.updated_at);
}

/**
 * The closure figures on Admin Reports. Closure rate is the whole-number percentage of orders
 * that are closed. Cycle time is the average working days from an order's creation to its
 * closure, to one decimal place. Each is null when there is nothing to measure, so a page can
 * show that rather than a zero that reads as a result.
 */
export function closureFigures(totalOrders: number, closed: ClosedOrder[]) {
  return {
    closure_rate: totalOrders > 0 ? Math.round((closed.length / totalOrders) * 100) : null,
    avg_cycle_days: averageCycleDays(closed),
  };
}

export function averageCycleDays(closed: ClosedOrder[]): number | null {
  const days = closed.map((o) => businessDaysBetween(o.created_at, closedAt(o)));
  return days.length ? Number((days.reduce((s, d) => s + d, 0) / days.length).toFixed(1)) : null;
}

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

  // The milestone dates are rolled up from the order's stores and invoices.
  const roll = rollupOrder(order);
  let stage: string;
  let since: Date;

  if (status === "BillingCompleted") {
    stage = "Awaiting payment";
    since = roll.billing_completed_at ?? order.updated_at ?? order.created_at;
  } else if (status === "Pending") {
    stage = "Pending (billing / payment)";
    since = roll.billing_completed_at ?? order.updated_at ?? order.created_at;
  } else if (status === "Installed") {
    stage = "Awaiting billing";
    since = roll.installed_at ?? order.updated_at ?? order.created_at;
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
