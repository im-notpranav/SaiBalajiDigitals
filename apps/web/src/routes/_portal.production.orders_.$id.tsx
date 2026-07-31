import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder } from "@/api/orders";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/production/orders_/$id")({
  head: () => ({ meta: [{ title: "Production Order Details — SB OMS" }] }),
  component: OrderDetailProduction,
});

function OrderDetailProduction() {
  const { id } = Route.useParams();
  const { user } = useAuth();

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
        description="Production view for line items and specs."
        crumbs={[{ label: "Production" }, { label: "Queue", to: "/production/queue" }, { label: "Details" }]}
      />
      <OrderDetail order={data.order} userRole={user?.role} />
    </>
  );
}
