import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "@/api/orders";
import { inr } from "@/lib/format";
import type { Order } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/accountant/billing")({
  head: () => ({ meta: [{ title: "Billing Queue — SB OMS" }] }),
  component: BillingQueue,
});

function BillingQueue() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "Active"],
    queryFn: () => fetchOrders({ status: "Active" }),
  });

  const queue = data?.orders || [];
  const total = queue.reduce((s: number, o: Order) => s + (o.total_amount || 0), 0);

  return (
    <>
      <PageHeader
        title="Billing Queue"
        description="All orders across employees that are currently 'Active' (Ready to Bill)."
        crumbs={[{ label: "Accountant" }, { label: "Billing" }]}
        actions={
          <div className="rounded-xl border bg-primary/5 px-4 py-2 text-sm">
            <span className="text-muted-foreground">Queue value:</span>{" "}
            <span className="font-semibold text-primary">{inr(total)}</span>
          </div>
        }
      />

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading billing queue...</div>
      ) : (
        <OrdersTable
          orders={queue}
          showCreator
          action={(o) => (
            <Link 
              to="/accountant/billing/$id" 
              params={{ id: String(o.id) }}
              className={buttonVariants({ variant: "default", size: "sm", className: "rounded-lg" })}
            >
              <Receipt className="mr-1 h-3.5 w-3.5" /> Invoice Order
            </Link>
          )}
        />
      )}
    </>
  );
}
