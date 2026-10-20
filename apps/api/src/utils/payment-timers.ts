/**
 * Overdue timers for payment requests: one per thing a request can be waiting on, each with
 * its own start, owner and day count. Pure functions, derived from the request every time it
 * is read, so a timer clears the moment its condition is resolved.
 */
import type { PaymentRequestStatus } from "@prisma/client";

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Day number in India time (day 0 = Thursday 1 Jan 1970). */
const istDay = (d: Date) => Math.floor((d.getTime() + IST_MS) / DAY_MS);

/**
 * Working days from `from` to `to` in India time: each day after `from` up to and including
 * `to`, Sundays not counted. The same rule as the order overdue report.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  const a = istDay(from);
  const b = istDay(to);
  let n = 0;
  for (let d = a + 1; d <= b; d++) if ((d + 4) % 7 !== 0) n++;
  return n;
}

export type TimerKind = "ADMIN_REVIEW" | "CCM_REVIEW" | "REPLY" | "PAYMENT" | "CLOSE" | "BILL";
/** Who has to act for the timer to stop. */
export type TimerOwner = "ADMIN" | "COST_CONTROL_MANAGER" | "REQUESTER";

export interface PaymentTimer {
  kind: TimerKind;
  owner: TimerOwner;
  /** What it is waiting for, e.g. "Waiting for Cost Control review". */
  label: string;
  /** Short form for chips, e.g. "Cost Control review". */
  short: string;
  since: Date;
  days: number;
  overdue: boolean;
}

type TimerDef = Omit<PaymentTimer, "since" | "days" | "overdue">;

/** The timer each waiting status runs, counted from when the request entered that status. */
const STATUS_TIMERS: Partial<Record<PaymentRequestStatus, TimerDef>> = {
  ADMIN_REVIEW: { kind: "ADMIN_REVIEW", owner: "ADMIN", label: "Waiting for Admin approval", short: "Admin approval" },
  CCM_REVIEW: { kind: "CCM_REVIEW", owner: "COST_CONTROL_MANAGER", label: "Waiting for Cost Control review", short: "Cost Control review" },
  INFO_REQUESTED: { kind: "REPLY", owner: "REQUESTER", label: "Returned, waiting for the requester", short: "Requester's reply" },
  PAYMENT_PENDING: { kind: "PAYMENT", owner: "COST_CONTROL_MANAGER", label: "Approved, waiting to be paid", short: "Payment" },
  PAID: { kind: "CLOSE", owner: "COST_CONTROL_MANAGER", label: "Paid, waiting to be closed", short: "Closing" },
};

const BILL_TIMER: TimerDef = { kind: "BILL", owner: "REQUESTER", label: "Bill not attached", short: "Bill" };

const FINISHED: PaymentRequestStatus[] = ["CLOSED", "REJECTED", "CANCELLED"];

export interface TimedRequest {
  status: PaymentRequestStatus;
  bill_details_required: boolean;
  status_changed_at: Date;
  created_at: Date;
}

/**
 * Every timer running on a request. A timer is overdue once it has run for more than
 * `threshold` working days. Finished requests run none.
 */
export function paymentTimers(r: TimedRequest, liveBills: number, threshold: number, now = new Date()): PaymentTimer[] {
  if (FINISHED.includes(r.status)) return [];
  const make = (def: TimerDef, since: Date): PaymentTimer => {
    const days = workingDaysBetween(since, now);
    return { ...def, since, days, overdue: days > threshold };
  };
  const timers: PaymentTimer[] = [];
  const byStatus = STATUS_TIMERS[r.status];
  if (byStatus) timers.push(make(byStatus, r.status_changed_at));
  // A bill promised at submission is chased from submission until one is attached.
  if (r.bill_details_required && liveBills === 0) timers.push(make(BILL_TIMER, r.created_at));
  return timers;
}

/** The timer owner a reviewer role answers for, for "waiting on you" lists. */
export const ownerFor = (role: string): TimerOwner | null =>
  role === "ADMIN" ? "ADMIN" : role === "COST_CONTROL_MANAGER" ? "COST_CONTROL_MANAGER" : null;
