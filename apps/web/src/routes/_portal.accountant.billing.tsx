import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { buttonVariants } from "@/components/ui/button";
import { Receipt, IndianRupee, Store } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "@/api/orders";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/accountant/billing")({
  head: () => ({ meta: [{ title: "Billing Queue — SB OMS" }] }),
  component: BillingQueue,
});

function BillingQueue() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "billing-queue"],
    queryFn: () => fetchOrders({ section: "active", limit: 100 }),
  });

  const all = data?.orders || [];
  // An order still in production/awaiting installation isn't the accountant's yet.
  const hasProduction = (o: Order) => (o.items ?? []).some((i) => (i.assignments?.length ?? 0) > 0);
  const isBillable = (o: Order) =>
    o.status === "Installed" || o.status === "Pending" || o.status === "BillingCompleted" ||
    (o.status === "Active" && !hasProduction(o));

  const queue = all.filter(isBillable);
  const total = queue.reduce((s: number, o: Order) => s + (o.total_amount || 0), 0);
  const awaitingPayment = queue.filter((o: Order) => o.status === "BillingCompleted").length;
  const inProduction = all.length - queue.length;

  return (
    <>
      <PageHeader
        title="Billing Queue"
        description="Orders awaiting an invoice or a payment."
        crumbs={[{ label: "Accountant" }, { label: "Billing" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {inProduction > 0 && (
              <div className="rounded-xl border bg-muted/40 px-4 py-2 text-sm">
                <span className="text-muted-foreground">In production:</span>{" "}
                <span className="font-semibold">{inProduction}</span>
              </div>
            )}
            {awaitingPayment > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
                <span className="text-muted-foreground">Awaiting payment:</span>{" "}
                <span className="font-semibold text-primary">{awaitingPayment}</span>
              </div>
            )}
            <div className="rounded-xl border bg-primary/5 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Queue value:</span>{" "}
              <span className="font-semibold text-primary">{inr(total)}</span>
            </div>
          </div>
        }
      />
      <OrdersTable
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        orders={queue}
        showCreator
        action={(o) => {
          // No stores means no items either: nothing to invoice until the CSM adds them.
          if ((o.store_count ?? o.stores?.length ?? 1) === 0) {
            return (
              <span
                title="The CSM has to add this order's stores and items before it can be invoiced."
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                <Store className="h-3.5 w-3.5" aria-hidden /> Needs stores
              </span>
            );
          }
          const awaitingPay = o.status === "BillingCompleted";
          return (
            <Link
              to="/accountant/billing/$id"
              params={{ id: String(o.id) }}
              className={buttonVariants({ variant: awaitingPay ? "secondary" : "default", size: "sm", className: cn("rounded-lg", awaitingPay && "border border-primary/40") })}
            >
              {awaitingPay ? (
                <><IndianRupee className="mr-1 h-3.5 w-3.5" /> Record Payment</>
              ) : (
                <><Receipt className="mr-1 h-3.5 w-3.5" /> Invoice Order</>
              )}
            </Link>
          );
        }}
      />
    </>
  );
}
