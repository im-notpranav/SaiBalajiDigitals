import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder } from "@/api/orders";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_portal/employee/orders_/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailEmployee,
});

function OrderDetailEmployee() {
  const { id } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  return (
    <>
      <PageHeader
        title={`Order ${data.order.order_no}`}
        description="Full order details and line items."
        crumbs={[{ label: "Employee" }, { label: "Orders", to: "/employee/orders" }, { label: "Details" }]}
      />
      <OrderDetail order={data.order} />
    </>
  );
}
