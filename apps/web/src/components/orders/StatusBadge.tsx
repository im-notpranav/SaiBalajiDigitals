import { cn } from "@/lib/utils";
import type { OrderStatus } from "@sb-oms/shared-types";
import { STAGE_STYLES, orderStage } from "@/lib/order-stage";

const styles: Record<string, { label: string; className: string }> = {
  Active: { label: "Active", className: "bg-info/15 text-info border border-info/30" },
  Installed: { label: "Installed", className: "bg-primary/15 text-primary border border-primary/30" },
  Pending: { label: "Pending", className: "bg-warning/15 text-warning-foreground border border-warning/30" },
  BillingCompleted: { label: "Awaiting Payment", className: "bg-primary/15 text-primary border border-primary/30" },
  PaymentReceived: { label: "Payment Received", className: "bg-success/15 text-success border border-success/30" },
  Completed: { label: "Completed", className: "bg-success/15 text-success border border-success/30" },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border border-border" },
  pending: { label: "Pending", className: "bg-warning/15 text-warning-foreground border border-warning/30" },
  in_production: { label: "In Production", className: "bg-info/15 text-info border border-info/30" },
  ready_to_bill: { label: "Ready to Bill", className: "bg-success/15 text-success border border-success/30" },
  billed: { label: "Billed", className: "bg-success/15 text-success border border-success/30" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground border border-border" },
};

export function StatusBadge({ status }: { status: OrderStatus | string }) {
  const s = styles[status as string] || { label: status, className: "bg-muted text-muted-foreground border border-border" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        s.className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {s.label}
    </span>
  );
}

/**
 * The stage an order is in now (Not assigned, In production, Installation, Invoice, Payment,
 * Completed), in that stage's colour. Shown in place of the raw status, which says "Active" for
 * the first three stages alike.
 */
export function OrderStageBadge({ order, className }: { order: Parameters<typeof orderStage>[0]; className?: string }) {
  const style = STAGE_STYLES[orderStage(order)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        style.badge,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {style.label}
    </span>
  );
}
