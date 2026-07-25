import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "@/api/orders";

export const Route = createFileRoute("/_portal/production/queue")({
  head: () => ({ meta: [{ title: "Production Queue — SB OMS" }] }),
  component: ProductionQueue,
});

function ProductionQueue() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "Active"],
    queryFn: () => fetchOrders({ status: "Active" }),
  });

  const queue = data?.orders || [];

  return (
    <>
      <PageHeader
        title="Production Queue"
        description="Advance orders to the next valid production status. Handoff notes feed remark_type."
        crumbs={[{ label: "Production" }, { label: "Queue" }]}
      />
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading production queue...</div>
      ) : (
        <OrdersTable
          orders={queue}
          showCreator
          action={(o) => (
            <Button
              size="sm"
              className="rounded-lg"
              onClick={() => toast.success(`Advanced ${o.order_no}`, { description: "Action to be implemented in Phase 3." })}
            >
              Advance <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
        />
      )}
    </>
  );
}
