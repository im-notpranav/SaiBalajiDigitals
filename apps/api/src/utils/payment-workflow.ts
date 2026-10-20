/**
 * Payment requests: when an order is open to them, and every move a request can make.
 *
 * Both are pure functions over plain rows, in the style of order-derive.ts, so the rules
 * live in one place and every controller asks the same question. A payment request is
 * money the company pays out to the requester by UPI; it never touches order status or
 * order revenue.
 *
 * Routes (decided 2026-10-20), fixed at submission by "Bill details required?":
 *   No bill  (ADMIN_THEN_CCM): ADMIN_REVIEW → CCM_REVIEW → PAYMENT_PENDING → PAID → CLOSED
 *   Bill     (CCM_ONLY):       CCM_REVIEW → PAYMENT_PENDING → PAID → CLOSED
 * Either review stage can reject (→ REJECTED) or return for information (→ INFO_REQUESTED,
 * and back to the same stage when the requester resubmits).
 */

import type { OrderStatus, PaymentAction, PaymentRequestStatus, PaymentRoute, Role } from "@prisma/client";
import { isBillingStarted } from "./order-status";
import { FIELD_ROLES } from "./roles";

/* ------------------------------------------------------------------ eligibility */

export interface EligibilityOrder {
  status: OrderStatus;
  items: { production_completed?: boolean | null; assignments?: unknown[] | null }[];
  stores?: { invoice_id: number | null }[];
  invoices?: unknown[];
}

export interface Eligibility {
  eligible: boolean;
  reason: string;
}

/**
 * Whether an order accepts *new* payment requests.
 *
 * Opens once production is finished: every item sent to production is produced, or the
 * order is already Installed. An order with nothing sent to production has nothing to wait
 * for and is open. Closes for good once billing starts, which is the first invoice on any
 * store, not only the statuses isBillingStarted() lists: a part-billed order can still read
 * "Installed". Requests already raised carry on after billing; only new ones stop.
 */
export function paymentEligibility(order: EligibilityOrder): Eligibility {
  const invoiced =
    (order.invoices?.length ?? 0) > 0 || (order.stores ?? []).some((s) => s.invoice_id != null);
  if (isBillingStarted(order.status) || invoiced) {
    return { eligible: false, reason: "Billing has started on this order, so it no longer takes new payment requests." };
  }
  if (order.status === "Installed") {
    return { eligible: true, reason: "Installed and not billed yet." };
  }

  const assigned = order.items.filter((i) => (i.assignments?.length ?? 0) > 0);
  if (assigned.length === 0) {
    return { eligible: true, reason: "No items are tracked through production, so the order is open." };
  }
  const done = assigned.filter((i) => i.production_completed).length;
  if (done < assigned.length) {
    return {
      eligible: false,
      reason: `Production is still running (${done} of ${assigned.length} items done). Requests open once it finishes.`,
    };
  }
  return { eligible: true, reason: "Production is complete and the order is not billed yet." };
}

/* ------------------------------------------------------------------ who */

/** Roles that raise payment requests: CSMs on their own orders, field staff on their jobs. */
export const REQUESTER_ROLES = ["CSM", ...FIELD_ROLES] as const;
export const REVIEWER_ROLES = ["ADMIN", "COST_CONTROL_MANAGER"] as const;
export const PAYMENT_ROLES = [...REQUESTER_ROLES, ...REVIEWER_ROLES] as const;

export const isRequesterRole = (role: string) => (REQUESTER_ROLES as readonly string[]).includes(role);
export const isReviewerRole = (role: string) => (REVIEWER_ROLES as readonly string[]).includes(role);

export const routeFor = (billDetailsRequired: boolean): PaymentRoute =>
  billDetailsRequired ? "CCM_ONLY" : "ADMIN_THEN_CCM";

/** The status a request starts in. */
export const firstStage = (route: PaymentRoute): PaymentRequestStatus =>
  route === "CCM_ONLY" ? "CCM_REVIEW" : "ADMIN_REVIEW";

/** Who decides at each review stage. */
export const STAGE_REVIEWER: Partial<Record<PaymentRequestStatus, Role>> = {
  ADMIN_REVIEW: "ADMIN",
  CCM_REVIEW: "COST_CONTROL_MANAGER",
};

/** Statuses a request can still move out of. */
export const OPEN_PAYMENT_STATUSES: PaymentRequestStatus[] = [
  "ADMIN_REVIEW",
  "CCM_REVIEW",
  "INFO_REQUESTED",
  "PAYMENT_PENDING",
  "PAID",
];
/** Requests that count towards an order's total asked for. */
export const LIVE_PAYMENT_STATUSES: PaymentRequestStatus[] = [...OPEN_PAYMENT_STATUSES, "CLOSED"];

/* ------------------------------------------------------------------ transitions */

export interface WorkflowRequest {
  status: PaymentRequestStatus;
  route: PaymentRoute;
  requested_by: number;
  returned_from: PaymentRequestStatus | null;
  bill_details_required: boolean;
}

/** Facts about a request that live outside its row, gathered by the caller when needed. */
export interface TransitionContext {
  /** Bills attached and not removed. */
  billCount?: number;
}

export interface Actor {
  id: number;
  role: Role | string;
}

type Check = { ok: true; to: PaymentRequestStatus } | { ok: false; status: 400 | 403 | 409; message: string };

interface Rule {
  /** Statuses the action may start from. */
  from: PaymentRequestStatus[];
  /** Whether this actor may take the action on this request (status already checked). */
  allowed: (r: WorkflowRequest, a: Actor) => boolean;
  to: (r: WorkflowRequest, a: Actor) => PaymentRequestStatus;
  /** A note the actor must give. */
  noteRequired?: (r: WorkflowRequest, a: Actor) => boolean;
  /** Who may do it, for the error message. */
  who: string;
  /** Why the action cannot happen yet, even though this actor may take it. */
  blockedBy?: (r: WorkflowRequest, ctx: TransitionContext) => string | null;
}

const isStageReviewer = (r: WorkflowRequest, a: Actor) => STAGE_REVIEWER[r.status] === a.role;
const isRequester = (r: WorkflowRequest, a: Actor) => r.requested_by === a.id;

/**
 * Every move a payment request can make: the one table the API consults. A rule passes
 * only when the request is in a `from` status and `allowed` holds for the actor.
 */
export const PAYMENT_RULES: Record<Exclude<PaymentAction, "SUBMIT" | "ATTACH" | "DETACH">, Rule> = {
  APPROVE: {
    from: ["ADMIN_REVIEW", "CCM_REVIEW"],
    allowed: isStageReviewer,
    to: (r) => (r.status === "ADMIN_REVIEW" ? "CCM_REVIEW" : "PAYMENT_PENDING"),
    who: "the reviewer for this stage",
  },
  REJECT: {
    from: ["ADMIN_REVIEW", "CCM_REVIEW"],
    allowed: isStageReviewer,
    to: () => "REJECTED",
    noteRequired: () => true,
    who: "the reviewer for this stage",
  },
  RETURN: {
    from: ["ADMIN_REVIEW", "CCM_REVIEW"],
    allowed: isStageReviewer,
    to: () => "INFO_REQUESTED",
    noteRequired: () => true,
    who: "the reviewer for this stage",
  },
  RESUBMIT: {
    from: ["INFO_REQUESTED"],
    allowed: isRequester,
    to: (r) => r.returned_from ?? firstStage(r.route),
    who: "the requester",
  },
  CANCEL: {
    // The requester may withdraw before anyone has approved it; an Admin may cancel any
    // request that has not been paid, with a reason.
    from: ["ADMIN_REVIEW", "CCM_REVIEW", "INFO_REQUESTED", "PAYMENT_PENDING"],
    allowed: (r, a) =>
      a.role === "ADMIN" ||
      (isRequester(r, a) && (r.status === firstStage(r.route) || r.status === "INFO_REQUESTED")),
    to: () => "CANCELLED",
    noteRequired: (r, a) => !isRequester(r, a),
    who: "the requester before approval, or an Admin",
  },
  MARK_PAID: {
    from: ["PAYMENT_PENDING"],
    allowed: (_r, a) => a.role === "COST_CONTROL_MANAGER",
    to: () => "PAID",
    who: "the Cost Control Manager",
  },
  CLOSE: {
    from: ["PAID"],
    allowed: (_r, a) => a.role === "COST_CONTROL_MANAGER",
    to: () => "CLOSED",
    who: "the Cost Control Manager",
    // A request raised with bill details cannot close until a bill is attached.
    blockedBy: (r, ctx) =>
      r.bill_details_required && !ctx.billCount
        ? "Attach the bill before closing: this request was raised with bill details."
        : null,
  },
};

export type WorkflowAction = keyof typeof PAYMENT_RULES;

export const STATUS_LABELS: Record<PaymentRequestStatus, string> = {
  ADMIN_REVIEW: "Admin review",
  CCM_REVIEW: "Cost Control review",
  INFO_REQUESTED: "Returned for info",
  PAYMENT_PENDING: "Payment pending",
  PAID: "Paid",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** May this actor take this action on this request now? */
export function checkTransition(
  r: WorkflowRequest,
  action: WorkflowAction,
  a: Actor,
  note?: string | null,
  ctx: TransitionContext = {},
): Check {
  const rule = PAYMENT_RULES[action];
  if (!rule.from.includes(r.status)) {
    return { ok: false, status: 409, message: `This request is ${STATUS_LABELS[r.status].toLowerCase()}, so it cannot be ${pastTense(action)} now.` };
  }
  if (!rule.allowed(r, a)) {
    return { ok: false, status: 403, message: `Only ${rule.who} can do that.` };
  }
  if (rule.noteRequired?.(r, a) && !note?.trim()) {
    return { ok: false, status: 400, message: "Give a reason." };
  }
  const blocked = rule.blockedBy?.(r, ctx);
  if (blocked) return { ok: false, status: 409, message: blocked };
  return { ok: true, to: rule.to(r, a) };
}

/** The actions this actor could take on this request now, for the UI. */
export function availableActions(r: WorkflowRequest, a: Actor): WorkflowAction[] {
  return (Object.keys(PAYMENT_RULES) as WorkflowAction[]).filter((action) => {
    const rule = PAYMENT_RULES[action];
    return rule.from.includes(r.status) && rule.allowed(r, a);
  });
}

function pastTense(action: WorkflowAction): string {
  return {
    APPROVE: "approved",
    REJECT: "rejected",
    RETURN: "returned",
    RESUBMIT: "resubmitted",
    CANCEL: "cancelled",
    MARK_PAID: "marked paid",
    CLOSE: "closed",
  }[action];
}

/* ------------------------------------------------------------------ format */

/** A UPI handle, name@bank (a phone number before the @ is fine). Not a full VPA check. */
export const UPI_PATTERN = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;

export const formatRupees = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
