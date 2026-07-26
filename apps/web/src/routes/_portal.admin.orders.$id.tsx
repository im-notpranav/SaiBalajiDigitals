import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder, forceCloseOrder } from "@/api/orders";
import { Loader2, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_portal/admin/orders/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailAdmin,
});

function OrderDetailAdmin() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const forceCloseMutation = useMutation({
    mutationFn: () => forceCloseOrder(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const actions = data.order.status !== "Completed" && (
    <div className="surface-panel p-6 mt-6 border-destructive/20 bg-destructive/5">
      <h3 className="text-sm font-semibold text-destructive mb-2 flex items-center gap-2">
        <AlertOctagon className="w-4 h-4" /> Danger Zone
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Force closing an order bypasses all standard workflow checks and transitions it immediately to Completed.
      </p>
      <Button 
        variant="destructive" 
        onClick={() => {
          if (confirm("Are you sure you want to force close this order? This action cannot be fully undone.")) {
            forceCloseMutation.mutate();
          }
        }}
        disabled={forceCloseMutation.isPending}
      >
        {forceCloseMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Force Close Order
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        title={`Order ${data.order.order_no}`}
        description="Full administrative view of order details."
        crumbs={[{ label: "Administrator" }, { label: "Orders", to: "/admin/orders" }, { label: "Details" }]}
      />
      <OrderDetail order={data.order} actions={actions} />
    </>
  );
}
