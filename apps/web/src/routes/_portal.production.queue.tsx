import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PRODUCTION_REMARK_TYPES } from "@/lib/constants";
import { ChevronRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOrders, advanceOrder } from "@/api/orders";
import type { Order } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/production/queue")({
  head: () => ({ meta: [{ title: "Production Queue — SB OMS" }] }),
  component: ProductionQueue,
});

function ProductionQueue() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<Order | null>(null);
  const [remarkType, setRemarkType] = useState<string>(PRODUCTION_REMARK_TYPES[0]!.value);
  const [remarkText, setRemarkText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "Active"],
    queryFn: () => fetchOrders({ status: "Active" }),
  });

  const queue = data?.orders || [];

  const advance = async () => {
    if (!target) return;
    try {
      await advanceOrder(target.id, {
        production_remark_type: remarkType,
        production_remark_text: remarkText || undefined,
      });
      toast.success(`Advanced ${target.order_no}`, {
        description: "Order moved to Pending status.",
      });
      setTarget(null);
      setRemarkText("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) {
      toast.error(`Failed to advance ${target.order_no}`, { description: e.message });
    }
  };

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
            <AlertDialog open={target?.id === o.id} onOpenChange={(open) => !open && setTarget(null)}>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="rounded-lg" onClick={() => setTarget(o)}>
                  Advance <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Advance {target?.order_no}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will transition the order from Active to Pending, making it visible in the Accountant queue for billing.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                
                <div className="py-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Production remark type</label>
                    <Select value={remarkType} onValueChange={setRemarkType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRODUCTION_REMARK_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold">Additional notes (optional)</label>
                    <Textarea 
                      rows={3} 
                      value={remarkText} 
                      onChange={(e) => setRemarkText(e.target.value)} 
                      placeholder="Add any production hand-off notes..." 
                    />
                  </div>
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setTarget(null)}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={advance}>Confirm advance</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        />
      )}
    </>
  );
}
