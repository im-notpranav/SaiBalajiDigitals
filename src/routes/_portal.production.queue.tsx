import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { ORDERS } from "@/lib/mock-data";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_portal/production/queue")({
  head: () => ({ meta: [{ title: "Production Queue — SB OMS" }] }),
  component: ProductionQueue,
});

function ProductionQueue() {
  const queue = ORDERS.filter((o) => o.status === "pending" || o.status === "in_production");

  return (
    <>
      <PageHeader
        title="Production Queue"
        description="Advance orders to the next valid production status. Handoff notes feed remark_type."
        crumbs={[{ label: "Production" }, { label: "Queue" }]}
      />
      <OrdersTable
        orders={queue}
        showCreator
        action={(o) => (
          <Button
            size="sm"
            className="rounded-lg"
            onClick={() => toast.success(`Advanced ${o.number}`, { description: "Server transitioned status." })}
          >
            Advance <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      />
    </>
  );
}
