import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder, forceCloseOrder, closeOrder } from "@/api/orders";
import { Loader2, AlertOctagon, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { REMARK_TYPES } from "@/lib/constants";
import type { RemarkType } from "@sb-oms/shared-types";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-store";

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

  const [remark, setRemark] = useState<RemarkType | "Other">(REMARK_TYPES[0]!.value);
  const [custom, setCustom] = useState("");

  const isCustom = remark === "Other";
  const canSubmitClose = !isCustom || custom.trim().length > 0;

  const forceCloseMutation = useMutation({
    mutationFn: () => forceCloseOrder(Number(id), { remarks: remark, remarks_other_text: isCustom ? custom : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order force closed");
    },
    onError: (err: any) => toast.error("Failed to force close", { description: err.message }),
  });

  const closeMutation = useMutation({
    mutationFn: () => closeOrder(Number(id), { remarks: remark, remarks_other_text: isCustom ? custom : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order closed successfully");
    },
    onError: (err: any) => toast.error("Failed to close", { description: err.message }),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const actions = data.order.status !== "Completed" && (
    <div className="space-y-6 mt-6">
      <div className="surface-panel p-6 border-warning/20 bg-warning/5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-warning" /> Close Order
        </h3>
        
        <div className="space-y-4 max-w-lg mb-6">
          <div>
            <label className="mb-1.5 block text-xs font-semibold">Closure remark type</label>
            <Select value={remark} onValueChange={(v) => setRemark(v as RemarkType | "Other")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REMARK_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
                <SelectItem value="Other">Other (Custom)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCustom && (
            <div className="animate-pop-in">
              <label className="mb-1.5 block text-xs font-semibold">
                Custom reason * <span className="text-destructive">(required)</span>
              </label>
              <Textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Explain the custom closure reason…" />
              {!custom.trim() && <p className="mt-1 text-xs text-destructive">Free-text reason is required for Custom Reason.</p>}
            </div>
          )}
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
          It uses the same remark selected above.
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
        description="Full administrative view of order details."
        crumbs={[{ label: "Administrator" }, { label: "Orders", to: "/admin/orders" }, { label: "Details" }]}
      />
      <OrderDetail order={data.order} actions={actions} userRole={user?.role} />
    </>
  );
}
