import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { OrderLinkedWork } from "@/components/orders/OrderLinkedWork";
import { fetchOrder, forceCloseOrder, closeOrder } from "@/api/orders";
import { Loader2, AlertOctagon, Lock, Pencil, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { CloseRemarkFields, EMPTY_CLOSE_REMARK, closeRemarkReady, type CloseRemark } from "@/components/orders/CloseRemarkFields";
import { friendlyError } from "@/lib/friendly-error";
import { useAuth, isReadOnlyRole } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/admin/orders_/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailAdmin,
});

function OrderDetailAdmin() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const [closeRemark, setCloseRemark] = useState<CloseRemark>(EMPTY_CLOSE_REMARK);
  const canSubmitClose = closeRemarkReady(closeRemark);
  const closeBody = () => ({ remarks: closeRemark.remarks, remarks_other_text: closeRemark.text.trim() });

  const forceCloseMutation = useMutation({
    mutationFn: () => forceCloseOrder(Number(id), closeBody()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order force closed");
    },
    onError: (err: any) => toast.error("Failed to force close", { description: friendlyError(err) }),
  });

  const closeMutation = useMutation({
    mutationFn: () => closeOrder(Number(id), closeBody()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order closed successfully");
    },
    onError: (err: any) => toast.error("Failed to close", { description: friendlyError(err) }),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const actions = !isReadOnlyRole(user?.role) && data.order.status !== "Completed" && (
    <div className="space-y-6 mt-6">
      <div className="surface-panel p-6 border-warning/20 bg-warning/5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-warning" /> Close Order
        </h3>
        
        <div className="max-w-lg mb-6">
          <CloseRemarkFields value={closeRemark} onChange={setCloseRemark} idPrefix="detail-close" />
        </div>

        {data.order.status === "Pending" && (
          <Button 
            onClick={() => closeMutation.mutate()}
            disabled={!canSubmitClose || closeMutation.isPending}
            className="mb-4"
          >
            {closeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Close Order
          </Button>
        )}
      </div>

      <div className="surface-panel p-6 border-destructive/20 bg-destructive/5">
        <h3 className="text-sm font-semibold text-destructive mb-2 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4" /> Danger Zone
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Force closing an order bypasses all standard workflow checks and transitions it immediately to Completed.
          It uses the same remark written above, which is required.
        </p>
        <Button 
          variant="destructive" 
          onClick={() => {
            if (confirm("Are you sure you want to force close this order? This action cannot be fully undone.")) {
              forceCloseMutation.mutate();
            }
          }}
          disabled={!canSubmitClose || forceCloseMutation.isPending}
        >
          {forceCloseMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Force Close Order
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title={`Order ${data.order.order_no}`}
        description="Full order details."
        crumbs={[{ label: "Automated System" }, { label: "Orders", to: "/admin/orders" }, { label: "Details" }]}
        actions={
          !isReadOnlyRole(user?.role) && data.order.status !== "Completed" ? (
            <div className="flex flex-wrap gap-2">
              <Link
                to="/admin/edit-order/$id"
                params={{ id: String(data.order.id) }}
                search={{ addLine: true }}
                className={buttonVariants({ variant: "outline" })}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Add Line Item
              </Link>
              <Link to="/admin/edit-order/$id" params={{ id: String(data.order.id) }} className={buttonVariants({ variant: "outline" })}>
                <Pencil className="mr-2 h-4 w-4" aria-hidden /> Edit order
              </Link>
            </div>
          ) : undefined
        }
      />
      <OrderDetail
        order={data.order}
        actions={actions}
        userRole={user?.role}
        currentUserId={user?.id}
        // Field jobs and payment requests go by this same order number.
        related={
          <OrderLinkedWork
            orderId={data.order.id}
            orderNo={data.order.order_no}
            showPayments={user?.role === "ADMIN"}
          />
        }
      />
    </>
  );
}
