/**
 * Loss accounting helpers — the single source of truth for what counts as billable vs loss.
 *
 * A line item is a *confirmed loss* only when it carries a loss remark AND an admin has confirmed it.
 * An employee-proposed remark (remarks set, remarks_confirmed = false) still counts as billable
 * until an admin approves it.
 *
 * Revised, ExtraAmount and LessAmount are not losses: they change what the line is billed at.
 *  - Revised: an admin corrected the line; `amount` is already the new figure, and
 *    `original_amount` keeps the old one for reporting.
 *  - ExtraAmount: billed at `amount + adjustment_amount`.
 *  - LessAmount: billed at `amount - adjustment_amount`.
 * Like losses, they move the bill only once confirmed. Whole-order Extra / Less Amounts live in
 * OrderAdjustment and count only when Approved.
 */

/** Remarks that take the whole line off the bill. */
export const LOSS_REMARKS = new Set(["Reprint", "Sample", "UnderWarranty", "FreeOfCost", "Other"]);
/** Remarks that change what the line is billed at, without writing it off. */
export const ADJUSTMENT_REMARKS = new Set(["Revised", "ExtraAmount", "LessAmount"]);

export const isLossRemark = (remarks: string | null | undefined): boolean => !!remarks && LOSS_REMARKS.has(remarks);

export const isConfirmedLoss = (item: any): boolean =>
  isLossRemark(item?.remarks) && item?.remarks_confirmed === true;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The signed change a confirmed adjustment makes against the line's plain amount:
 * + for Extra, - for Less, new minus old for Revised. 0 for everything else.
 */
export function itemAdjustment(item: any): number {
  if (!item?.remarks_confirmed) return 0;
  const adj = Number(item.adjustment_amount) || 0;
  if (item.remarks === "ExtraAmount") return adj;
  if (item.remarks === "LessAmount") return -adj;
  if (item.remarks === "Revised" && item.original_amount != null) {
    return round2((Number(item.amount) || 0) - Number(item.original_amount));
  }
  return 0;
}

/** What one line contributes to the bill. */
export function itemBillable(item: any): number {
  if (isConfirmedLoss(item)) return 0;
  const amt = Number(item?.amount) || 0;
  // Revised is already reflected in `amount`.
  if (item?.remarks === "Revised") return amt;
  return Math.max(0, round2(amt + itemAdjustment(item)));
}

/** The signed effect of a whole-order adjustment; only Approved rows count. */
export function orderAdjustmentValue(adj: any): number {
  if (adj?.status !== "Approved") return 0;
  const amt = Number(adj.amount) || 0;
  return adj.type === "LessAmount" ? -amt : adj.type === "ExtraAmount" ? amt : 0;
}

/**
 * Split an order's items into the billable total (what the customer owes) and the loss total
 * (confirmed write-offs). Proposed-but-unconfirmed remarks are treated as billable at the plain
 * amount. `adjustments` are the whole-order Extra / Less rows for the same items' stores.
 *
 * `adjustment_amount` is the net signed effect of every confirmed line adjustment and every
 * approved order adjustment, so a bill reads as plain work + adjustments - losses.
 */
export function computeTotals(
  items: any[] | undefined | null,
  adjustments: any[] | undefined | null = [],
): { total_amount: number; loss_amount: number; adjustment_amount: number } {
  let billable = 0;
  let loss = 0;
  let adjusted = 0;
  for (const i of items ?? []) {
    if (isConfirmedLoss(i)) loss += Number(i.amount) || 0;
    else billable += itemBillable(i);
    adjusted += itemAdjustment(i);
  }
  for (const a of adjustments ?? []) {
    const v = orderAdjustmentValue(a);
    billable += v;
    adjusted += v;
  }
  return {
    total_amount: round2(Math.max(0, billable)),
    loss_amount: round2(loss),
    adjustment_amount: round2(adjusted),
  };
}
