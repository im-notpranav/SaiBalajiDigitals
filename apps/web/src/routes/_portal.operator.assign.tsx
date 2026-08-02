import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchOrders, assignOrderItem } from "@/api/orders";
import { fetchProductionStaff } from "@/api/users";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CheckCircle2, Flag } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/orders/StatusBadge";
import type { Order, OrderItem } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/operator/assign")({
  head: () => ({ meta: [{ title: "Assign Work — SB OMS" }] }),
  component: OperatorAssignPage,
});

function OperatorAssignPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "operator"],
    queryFn: () => fetchOrders({ limit: 100 }),
  });

  const { data: staffData } = useQuery({
    queryKey: ["production-staff"],
    queryFn: fetchProductionStaff,
  });

  const staff = staffData?.users ?? [];

  const assignMutation = useMutation({
    mutationFn: ({ orderId, itemId, assignedTo }: { orderId: number; itemId: number; assignedTo: number | null }) =>
      assignOrderItem(orderId, itemId, assignedTo),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(vars.assignedTo === null ? "Assignment cleared" : "Item assigned");
    },
    onError: (err: any) =>
      toast.error("Failed to assign", { description: err?.response?.data?.message || err.message }),
  });

  const orders: Order[] = data?.orders ?? [];

  return (
    <>
      <PageHeader
        title="Assign Work"
        description="Assign each line item to a production employee. An order can only be billed once every assigned item is complete."
        crumbs={[{ label: "Operator" }, { label: "Assign Work" }]}
      />

      {isLoading ? (
        <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : orders.length === 0 ? (
        <div className="surface-panel p-12 text-center text-muted-foreground">No active orders to assign.</div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const items = order.items ?? [];
            const assigned = items.filter((i) => i.assigned_to);
            const done = assigned.filter((i) => i.production_completed).length;

            return (
              <section key={order.id} className="surface-panel p-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{order.order_no}</h3>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {order.client_name} · {order.store_name} ({order.location})
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-muted-foreground uppercase tracking-wider">Production</div>
                    <div className="font-semibold">
                      {assigned.length === 0
                        ? "Nothing assigned"
                        : `${done} of ${assigned.length} complete`}
                    </div>
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
                      <TableHead>Status</TableHead>
                      <TableHead className="w-56">Assigned To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item: OrderItem) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-center text-muted-foreground">{item.s_no}</TableCell>
                        <TableCell className="font-medium">{item.media}</TableCell>
                        <TableCell className="text-right">{item.width_inches} x {item.height_inches}</TableCell>
                        <TableCell className="text-right">{item.qty}</TableCell>
                        <TableCell className="text-right">{(item.total_sft || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          {item.is_flagged ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                              <Flag className="h-3 w-3" /> Flagged
                            </span>
                          ) : item.production_completed ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                            </span>
                          ) : item.assigned_to ? (
                            <span className="text-xs text-muted-foreground">In production</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={item.assigned_to ? String(item.assigned_to) : "none"}
                            onValueChange={(v) =>
                              assignMutation.mutate({
                                orderId: order.id,
                                itemId: item.id!,
                                assignedTo: v === "none" ? null : Number(v),
                              })
                            }
                            disabled={assignMutation.isPending}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none" className="text-muted-foreground italic">Unassigned</SelectItem>
                              {staff.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {item.production_completed && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Reassigning will reset completion.
                            </p>
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
