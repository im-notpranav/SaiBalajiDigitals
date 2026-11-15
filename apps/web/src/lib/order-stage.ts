import type { Order, OrderItem } from "@sb-oms/shared-types";

/**
 * The six stages every order passes through, and the one colour each stage has across the app:
 * the dashboards' stage cards, the stage badge on order lists and order pages. Same rule as the
 * API's dashboard (apps/api/src/controllers/dashboard.controller.ts); change both together.
 */
export type StageKey = "unassigned" | "production" | "installation" | "billing" | "payment" | "completed";

export interface StageStyle {
  label: string;
  /** Icon and figure colour. */
  text: string;
  /** Pale tint behind an icon or an open card. */
  bg: string;
  border: string;
  /** A small badge: tint, readable text and a faint rim, in light and dark. */
  badge: string;
}

export const STAGE_STYLES: Record<StageKey, StageStyle> = {
  unassigned: {
    label: "Not assigned",
    text: "text-slate-500",
    bg: "bg-slate-500/10",
    border: "border-slate-500/25",
    badge: "bg-slate-500/10 text-slate-700 border-slate-500/25 dark:text-slate-300",
  },
  production: {
    label: "In production",
    text: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/25",
    badge: "bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-300",
  },
  installation: {
    label: "Installation",
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
    badge: "bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300",
  },
  billing: {
    label: "Invoice",
    text: "text-violet-500",
    bg: "bg-violet-500/10",
    border: "border-violet-500/25",
    badge: "bg-violet-500/10 text-violet-700 border-violet-500/25 dark:text-violet-300",
  },
  payment: {
    label: "Payment",
    text: "text-cyan-600",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/25",
    badge: "bg-cyan-500/10 text-cyan-800 border-cyan-500/30 dark:text-cyan-300",
  },
  completed: {
    label: "Completed",
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
    badge: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
  },
};

type StageItem = Pick<OrderItem, "assignments" | "production_completed">;

/**
 * Where an order is now. An open order with no item given to production is "Not assigned"; once
 * every assigned item is produced it waits for installation.
 */
export function orderStage(order: Pick<Order, "status"> & { items?: StageItem[] }): StageKey {
  switch (order.status) {
    case "Completed":
    case "PaymentReceived":
      return "completed";
    case "BillingCompleted":
    case "Pending":
      return "payment";
    case "Installed":
      return "billing";
  }
  const assigned = (order.items ?? []).filter((i) => (i.assignments?.length ?? 0) > 0);
  if (assigned.length === 0) return "unassigned";
  return assigned.every((i) => i.production_completed) ? "installation" : "production";
}

/** The stages in the order an order moves through them, for sorting by stage. */
export const STAGE_ORDER: StageKey[] = ["unassigned", "production", "installation", "billing", "payment", "completed"];
