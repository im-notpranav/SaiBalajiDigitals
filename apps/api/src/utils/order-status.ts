/**
 * Billing-split status vocabulary (Phase 5).
 *
 * Active            → in flight (being created / in production)
 * Installed         → produced and installation-confirmed by the employee; ready to bill
 * Pending           → billed short, or part-paid: needs attention
 * BillingCompleted  → invoice raised in full, awaiting payment
 * PaymentReceived   → paid in full — the happy-path terminal state
 * Completed         → closed by an admin (force-close / closure remark)
 */

import type { OrderStatus } from "@prisma/client";

/** Orders that are finished and should appear under "completed" surfaces. */
export const CLOSED_STATUSES: OrderStatus[] = ["PaymentReceived", "Completed"];

/** Orders still moving through the pipeline. */
export const OPEN_STATUSES: OrderStatus[] = ["Active", "Pending", "Installed", "BillingCompleted"];

/** Statuses whose value counts as realised revenue. */
export const REVENUE_STATUSES: OrderStatus[] = ["PaymentReceived", "Completed"];

export const isClosed = (status: string) => (CLOSED_STATUSES as string[]).includes(status);

/** Statuses where billing has started — CSMs can no longer add line items. */
export const BILLING_STARTED_STATUSES: OrderStatus[] = ["BillingCompleted", "Pending", "PaymentReceived", "Completed"];
export const isBillingStarted = (status: string) => (BILLING_STARTED_STATUSES as string[]).includes(status);

/** CSM-editable statuses: line items may be added until billing touches the order. */
export const CSM_EDITABLE_STATUSES: OrderStatus[] = ["Active", "Installed"];
export const isCsmEditable = (status: string) => (CSM_EDITABLE_STATUSES as string[]).includes(status);
