/**
 * Loss accounting helpers — the single source of truth for what counts as billable vs loss.
 *
 * A line item is a *confirmed loss* only when it carries a remark AND an admin has confirmed it.
 * An employee-proposed remark (remarks set, remarks_confirmed = false) still counts as billable
 * until an admin approves it.
 */

export const isConfirmedLoss = (item: any): boolean =>
  item?.remarks != null && item?.remarks_confirmed === true;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Split an order's items into the billable total (what the customer owes) and the loss total
 * (confirmed write-offs). Proposed-but-unconfirmed remarks are treated as billable.
 */
export function computeTotals(items: any[] | undefined | null): { total_amount: number; loss_amount: number } {
  let billable = 0;
  let loss = 0;
  for (const i of items ?? []) {
    const amt = Number(i.amount) || 0;
    if (isConfirmedLoss(i)) loss += amt;
    else billable += amt;
  }
  return { total_amount: round2(billable), loss_amount: round2(loss) };
}
