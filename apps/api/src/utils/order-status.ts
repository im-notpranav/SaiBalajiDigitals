/**
 * Billing-split status vocabulary (Phase 5).
 *
 * Active            → in flight, not yet billed
 * Pending           → billed short, or part-paid: needs attention
 * BillingCompleted  → invoice raised in full, awaiting payment
 * PaymentReceived   → paid in full — the happy-path terminal state
 * Completed         → closed by an admin (force-close / closure remark)
 */

import type { OrderStatus } from "@prisma/client";

/** Orders that are finished and should appear under "completed" surfaces. */
export const CLOSED_STATUSES: OrderStatus[] = ["PaymentReceived", "Completed"];

/** Orders still moving through the pipeline. */
export const OPEN_STATUSES: OrderStatus[] = ["Active", "Pending", "BillingCompleted"];

/** Statuses whose value counts as realised revenue. */
export const REVENUE_STATUSES: OrderStatus[] = ["PaymentReceived", "Completed"];

export const isClosed = (status: string) => (CLOSED_STATUSES as string[]).includes(status);
