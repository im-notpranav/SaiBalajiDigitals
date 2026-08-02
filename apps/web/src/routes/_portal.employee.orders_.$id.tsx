import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder, markOrderInstalled } from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Loader2, PackageCheck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import type { OrderItem } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/employee/orders_/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailEmployee,
});

function OrderDetailEmployee() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const installMutation = useMutation({
    mutationFn: () => markOrderInstalled(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Installation confirmed", { description: "The order is now ready for billing." });
    },
    onError: (err: any) =>
      toast.error("Couldn't mark installed", { description: err?.response?.data?.message || err.message }),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const order = data.order;
  const items = order.items ?? [];
  const assignedItems = items.filter((i: OrderItem) => (i.assignments?.length ?? 0) > 0);
  const hasProduction = assignedItems.length > 0;
  const allProduced = hasProduction && assignedItems.every((i: OrderItem) => i.production_completed);

  // Installation is the employee's hand-off to billing — only for produced orders.
  const canInstall = hasProduction && allProduced && order.status === "Active";

  const actions =
    order.status === "Installed" ? (
      <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-sm">
        <div className="flex items-center gap-2 font-semibold text-success">
          <CheckCircle2 className="h-5 w-5" /> Installation confirmed
        </div>
        <p className="mt-1 text-muted-foreground">
          Sent to accounts for billing{order.installed_at ? ` on ${new Date(order.installed_at).toLocaleDateString("en-IN")}` : ""}.
        </p>
      </div>
    ) : canInstall ? (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
        <h3 className="mb-1 text-lg font-semibold flex items-center gap-2">
          <PackageCheck className="h-5 w-5 text-primary" /> Confirm Installation
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          All production is complete. Confirm the order has been installed to send it to accounts for billing.
        </p>
        <Button onClick={() => installMutation.mutate()} disabled={installMutation.isPending}>
          {installMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Mark as Installed
        </Button>
      </div>
    ) : hasProduction && order.status === "Active" ? (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        Installation can be confirmed once all assigned items are produced.
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title={`Order ${order.order_no}`}
        description="Full order details and line items."
        crumbs={[{ label: "Employee" }, { label: "Orders", to: "/employee/orders" }, { label: "Details" }]}
      />
      <OrderDetail order={order} userRole={user?.role} actions={actions} />
    </>
  );
}
