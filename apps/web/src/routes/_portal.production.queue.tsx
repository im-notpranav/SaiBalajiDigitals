import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchOrders, completeOrderItem } from "@/api/orders";
import { CheckCircle2, Flag, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { Order, OrderItem } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/production/queue")({
  head: () => ({ meta: [{ title: "Production Queue — SB OMS" }] }),
  component: ProductionQueue,
});

function ProductionQueue() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "Active"],
    queryFn: () => fetchOrders({ status: "Active" }),
  });

  const completeMutation = useMutation({
    mutationFn: ({ orderId, itemId, done }: { orderId: number; itemId: number; done: boolean }) =>
      completeOrderItem(orderId, itemId, done),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(vars.done ? "Marked complete" : "Reopened");
    },
    onError: (err: any) =>
      toast.error("Could not update item", { description: err?.response?.data?.message || err.message }),
  });

  const orders: Order[] = data?.orders ?? [];
  const totalItems = orders.reduce((n, o) => n + (o.items?.length ?? 0), 0);

  return (
    <>
      <PageHeader
        title="My Production Queue"
        description="Line items assigned to you. Mark each one complete as you finish it."
        crumbs={[{ label: "Production" }, { label: "Queue" }]}
      />

      {isLoading ? (
        <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : totalItems === 0 ? (
        <div className="surface-panel p-12 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-20" />
          <p>Nothing assigned to you right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const items = order.items ?? [];
            if (items.length === 0) return null;
            const done = items.filter((i) => i.production_completed).length;

            return (
              <section key={order.id} className="surface-panel p-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                  <div>
                    <h3 className="font-semibold">{order.order_no}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {order.client_name} · {order.store_name} ({order.location})
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <div className="uppercase tracking-wider text-muted-foreground">My items</div>
                    <div className="font-semibold">{done} of {items.length} complete</div>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>Media</TableHead>
                      <TableHead className="text-right">Size (in)</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Total Sft</TableHead>
                      <TableHead className="text-right w-44">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item: OrderItem) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-center text-muted-foreground">{item.s_no}</TableCell>
                        <TableCell className="font-medium">
                          {item.media}
                          {item.is_flagged && (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                              <Flag className="h-3 w-3" /> Flagged — on hold
                              {item.flag_reason && <span className="font-normal opacity-80">({item.flag_reason})</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{item.width_inches} x {item.height_inches}</TableCell>
                        <TableCell className="text-right">{item.qty}</TableCell>
                        <TableCell className="text-right">{(item.total_sft || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          {item.production_completed ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Reopen"
                                disabled={completeMutation.isPending}
                                onClick={() => completeMutation.mutate({ orderId: order.id, itemId: item.id!, done: false })}
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              disabled={completeMutation.isPending || item.is_flagged}
                              title={item.is_flagged ? "Flagged items must be resolved by an admin first" : undefined}
                              onClick={() => completeMutation.mutate({ orderId: order.id, itemId: item.id!, done: true })}
                            >
                              Mark complete
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
