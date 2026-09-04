/**
 * Order status is derived, never assigned directly.
 *
 * An order spans many stores and many invoices, so its status is a function of where all
 * of them are: it cannot be set correctly from inside any single store or invoice write.
 * Call `recomputeOrderStatus` at the end of every transaction that touches a store, a line
 * item or an invoice.
 *
 * The one exception is `Completed`, which an admin sets explicitly via closeOrder /
 * forceCloseOrder. Derivation never overwrites it.
 */

import type { OrderStatus } from "@prisma/client";
import { computeTotals } from "./order-totals";

/** Money comparisons are on 2-decimal values; tolerate float noise below half a paisa. */
const EPSILON = 0.005;
const eq = (a: number, b: number) => Math.abs(a - b) < EPSILON;

interface DerivableOrder {
  status: OrderStatus;
  items: any[];
  stores: { installed_at: Date | null; invoice_id: number | null }[];
  invoices: { bill_amount: any; amount_received: any }[];
}

/**
 * The status table, in precedence order. The conditions overlap — an order can be both
 * "fully billed" and "part paid" — so the order of these checks is what makes the result
 * well defined, not the conditions alone.
 */
export function deriveStatus(order: DerivableOrder): OrderStatus {
  // Set by an admin closing the order; not ours to revisit.
  if (order.status === "Completed") return "Completed";

  if (order.stores.length === 0) return "Active";

  // The installation clauses only govern an order accounts has not finished covering.
  //
  // Installation became a required checkpoint after this system had already billed orders,
  // so migrated rows can be fully invoiced with no installation date ever recorded. Reading
  // the table literally would derive "Active" for them and walk a billed order backwards.
  // An order every store of which is on an invoice is past installation by definition.
  const allBilled = order.stores.every((s) => s.invoice_id != null);
  if (!allBilled) {
    // Still in flight while any store is uninstalled.
    if (order.stores.some((s) => s.installed_at == null)) return "Active";
    // Installed everywhere, but accounts has not covered every store yet.
    return "Installed";
  }

  const billable = computeTotals(order.items).total_amount;
  const billed = order.invoices.reduce((sum, i) => sum + Number(i.bill_amount ?? 0), 0);
  const fullyBilled = eq(billed, billable);

  // Every invoice settled in full, against the order's full billable value.
  const allPaid = order.invoices.length > 0 &&
    order.invoices.every((i) => eq(Number(i.amount_received ?? 0), Number(i.bill_amount ?? 0)));
  if (fullyBilled && allPaid) return "PaymentReceived";

  // Billed short, or someone has part-paid: either way it needs chasing.
  const anyPartPaid = order.invoices.some((i) => {
    const received = Number(i.amount_received ?? 0);
    return received > 0 && !eq(received, Number(i.bill_amount ?? 0));
  });
  if (!fullyBilled || anyPartPaid) return "Pending";

  return "BillingCompleted";
}

/**
 * Reload the order, derive its status, and persist it if it moved. Returns the status the
 * order now has, so the caller can decide whether the transition is worth notifying about
 * — a 20-store job should tell accounts once, not twenty times.
 *
 * `tx` is a Prisma transaction client; the caller is responsible for having set
 * `app.current_user_id` so the audit trigger attributes the write.
 */
export async function recomputeOrderStatus(tx: any, orderId: number): Promise<OrderStatus> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      stores: { select: { installed_at: true, installed_by: true, invoice_id: true } },
      invoices: { orderBy: { id: "asc" } },
    },
  });
  if (!order) throw new Error(`recomputeOrderStatus: order ${orderId} not found`);

  const next = deriveStatus(order);
  if (next !== order.status) {
    await tx.order.update({ where: { id: orderId }, data: { status: next } });
  }
  return next;
}

const maxDate = (dates: (Date | string | null | undefined)[]): Date | null => {
  const times = dates.filter(Boolean).map((d) => new Date(d as Date).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
};

/**
 * An order's stores and invoices summarised back to the order level.
 *
 * These figures used to live in columns on `Order`. They are derived now, because an order
 * spans many stores and many invoices and a single column cannot represent that: the
 * invoice "number" is every invoice on the order, the billed amount is their sum, and the
 * installation date is when the *last* store went in.
 *
 * Pass an order loaded with `stores` and `invoices`.
 */
export function rollupOrder(order: {
  stores?: { installed_at?: Date | null; installed_by?: number | null }[];
  invoices?: {
    invoice_no: string;
    bill_amount: any;
    billing_date?: Date | null;
    billing_completed_at?: Date | null;
    amount_received?: any;
    payment_received_at?: Date | null;
    payment_received_by?: number | null;
  }[];
}) {
  const stores = order.stores ?? [];
  const invoices = order.invoices ?? [];

  // Only once every store is in is the order itself installed.
  const installedTimes = stores.map((s) => s.installed_at).filter(Boolean);
  const allInstalled = stores.length > 0 && installedTimes.length === stores.length;
  const installed_at = allInstalled ? maxDate(installedTimes) : null;
  const installed_by = allInstalled
    ? (stores.find((s) => new Date(s.installed_at as Date).getTime() === installed_at!.getTime())?.installed_by ?? null)
    : null;

  const paid = invoices.filter((i) => i.amount_received != null);

  return {
    installed_at,
    installed_by,
    invoice_no: invoices.length ? invoices.map((i) => i.invoice_no).join(", ") : null,
    bill_amount: invoices.length ? invoices.reduce((s, i) => s + Number(i.bill_amount ?? 0), 0) : null,
    billing_date: maxDate(invoices.map((i) => i.billing_date)),
    /** Set only when every invoice on the order has been raised in full. */
    billing_completed_at:
      invoices.length > 0 && invoices.every((i) => i.billing_completed_at != null)
        ? maxDate(invoices.map((i) => i.billing_completed_at))
        : null,
    amount_received: paid.length ? paid.reduce((s, i) => s + Number(i.amount_received ?? 0), 0) : null,
    payment_received_at: maxDate(paid.map((i) => i.payment_received_at)),
    payment_received_by:
      paid
        .slice()
        .sort((a, b) => new Date(a.payment_received_at ?? 0).getTime() - new Date(b.payment_received_at ?? 0).getTime())
        .at(-1)?.payment_received_by ?? null,
  };
}

/** The store label for a list row: the store itself, or a count when there are several. */
export function storeLabelOf(order: { stores?: { store_name: string }[] }): string {
  const stores = order.stores ?? [];
  if (stores.length > 1) return `${stores.length} stores`;
  return stores[0]?.store_name ?? "—";
}

/** The location for a list row; blank when an order spans several stores. */
export function storeLocationOf(order: { stores?: { location: string }[] }): string {
  const stores = order.stores ?? [];
  return stores.length === 1 ? (stores[0]?.location ?? "") : "";
}
