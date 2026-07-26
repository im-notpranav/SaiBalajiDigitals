import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
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
        description="View active orders currently in production."
        crumbs={[{ label: "Production" }, { label: "Queue" }]}
      />
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading production queue...</div>
      ) : (
        <OrdersTable
          orders={queue}
          showCreator
        />
      )}
    </>
  );
}
