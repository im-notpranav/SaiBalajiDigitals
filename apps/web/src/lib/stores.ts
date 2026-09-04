import type { Order, OrderStore } from "@sb-oms/shared-types";

/**
 * How an order's stores read in a list: the store itself when there is one,
 * a count when the order covers several.
 */
export function storeLabel(order: Pick<Order, "stores" | "store_count">): string {
  const count = order.store_count ?? order.stores?.length ?? 0;
  if (count > 1) return `${count} stores`;
  return order.stores?.[0]?.store_name ?? "—";
}

/** Secondary line for a list row: the location, or the store names when there are a few. */
export function storeSubLabel(order: Pick<Order, "stores" | "store_count">): string {
  const stores = order.stores ?? [];
  if (stores.length > 1) {
    const names = stores.map((s) => s.store_name);
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
  }
  return stores[0]?.location ?? "";
}

/** The roll-up of an order's invoices; billing figures no longer live on the order. */
export function billingRollup(order: Pick<Order, "invoices">) {
  const invoices = order.invoices ?? [];
  const maxDate = (ds: (string | null | undefined)[]) => {
    const t = ds.filter(Boolean).map((d) => new Date(d as string).getTime());
    return t.length ? new Date(Math.max(...t)) : null;
  };
  return {
    invoice_no: invoices.length ? invoices.map((i) => i.invoice_no).join(", ") : null,
    bill_amount: invoices.reduce((s, i) => s + Number(i.bill_amount ?? 0), 0),
    amount_received: invoices.reduce((s, i) => s + Number(i.amount_received ?? 0), 0),
    /** Set only once every invoice on the order has been raised in full. */
    billing_completed_at:
      invoices.length > 0 && invoices.every((i) => i.billing_completed_at != null)
        ? maxDate(invoices.map((i) => i.billing_completed_at))
        : null,
  };
}

/** When the order was installed — that is, when its last store went in. */
export function installedAt(order: Pick<Order, "stores">): string | null {
  const stores = order.stores ?? [];
  const times = stores.map((s) => s.installed_at).filter(Boolean);
  if (stores.length === 0 || times.length !== stores.length) return null;
  return times.sort().at(-1) ?? null;
}

/** "S03 — Banjara Hills" for a store heading; the order number is shown alongside. */
export function storeRef(store: Pick<OrderStore, "s_no" | "store_name">): string {
  return `S${String(store.s_no).padStart(2, "0")} — ${store.store_name}`;
}

export const isStoreInstalled = (store: Pick<OrderStore, "installed_at">) => store.installed_at != null;
