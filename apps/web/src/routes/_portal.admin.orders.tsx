import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "@/api/orders";

export const Route = createFileRoute("/_portal/admin/orders")({
  head: () => ({ meta: [{ title: "Order Oversight — SB OMS" }] }),
  component: AdminOrders,
});

function AdminOrders() {
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "admin"],
    queryFn: () => fetchOrders(),
  });

  return (
    <>
      <PageHeader
        title="Order Oversight"
        description="Full unfiltered view — every order, every creator, every status. Override edits generate audit entries."
        crumbs={[{ label: "Administrator" }, { label: "Orders" }]}
      />
      <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
        <ShieldAlert className="mr-2 inline h-4 w-4" />
        <span className="font-semibold">Admin Override:</span> edits here bypass role-restricted flows and are recorded in
        the audit log with a distinct action type.
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
      ) : (
        <OrdersTable orders={data?.orders || []} showCreator />
      )}
    </>
  );
}
