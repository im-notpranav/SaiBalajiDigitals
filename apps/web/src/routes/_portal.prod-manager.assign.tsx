import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchOrders, assignOrderItem } from "@/api/orders";
import { fetchProductionStaff } from "@/api/users";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, CheckCircle2, Flag, Users, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/orders/StatusBadge";
import type { Order, OrderItem } from "@sb-oms/shared-types";
import { storeLabel, storeSubLabel } from "@/lib/stores";

export const Route = createFileRoute("/_portal/prod-manager/assign")({
  head: () => ({ meta: [{ title: "Assign Work — SB OMS" }] }),
  component: ProdManagerAssignPage,
});

function ProdManagerAssignPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "prod-manager"],
    queryFn: () => fetchOrders({ limit: 100 }),
  });

  const { data: staffData } = useQuery({
    queryKey: ["production-staff"],
    queryFn: fetchProductionStaff,
  });

  const staff = staffData?.users ?? [];

  const assignMutation = useMutation({
    mutationFn: ({ orderId, itemId, assignedTo }: { orderId: number; itemId: number; assignedTo: number[] }) =>
      assignOrderItem(orderId, itemId, assignedTo),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success(vars.assignedTo.length === 0 ? "Assignments cleared" : "Assignments updated");
    },
    onError: (err: any) =>
      toast.error("Failed to assign", { description: err?.response?.data?.message || err.message }),
  });

  const toggleAssignee = (order: Order, item: OrderItem, userId: number) => {
    const current = (item.assignments ?? []).map((a) => a.user_id);
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    assignMutation.mutate({ orderId: order.id, itemId: item.id!, assignedTo: next });
  };

  const orders: Order[] = data?.orders ?? [];

  return (
    <>
      <PageHeader
        title="Assign Work"
        description="Assign each line item to a production employee. An order can only be billed once every assigned item is complete."
        crumbs={[{ label: "Production Manager" }, { label: "Assign Work" }]}
      />

      {isLoading ? (
        <div className="p-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : orders.length === 0 ? (
        <div className="surface-panel p-12 text-center text-muted-foreground">No active orders to assign.</div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const items = order.items ?? [];
            const assigned = items.filter((i) => (i.assignments?.length ?? 0) > 0);
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
                      {order.client_name} · {storeLabel(order as any)}{storeSubLabel(order as any) ? ` (${storeSubLabel(order as any)})` : ""}
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
                          ) : (item.assignments?.length ?? 0) > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {(item.assignments ?? []).filter((a) => a.completed).length} of {item.assignments!.length} done
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs font-normal" disabled={assignMutation.isPending}>
                                <span className="flex items-center gap-1.5 truncate">
                                  <Users className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                  {(item.assignments?.length ?? 0) === 0
                                    ? <span className="text-muted-foreground italic">Unassigned</span>
                                    : `${item.assignments!.length} team${item.assignments!.length === 1 ? "" : "s"}`}
                                </span>
                                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-56 p-2">
                              <p className="px-1 pb-2 text-[11px] text-muted-foreground">
                                Assign one or more teams. All must finish before the item is complete.
                              </p>
                              <div className="space-y-1">
                                {staff.map((s) => {
                                  const a = (item.assignments ?? []).find((x) => x.user_id === s.id);
                                  return (
                                    <label
                                      key={s.id}
                                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"
                                    >
                                      <Checkbox
                                        checked={!!a}
                                        onCheckedChange={() => toggleAssignee(order, item, s.id)}
                                      />
                                      <span className="flex-1 truncate">{s.name}</span>
                                      {a?.completed && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                                    </label>
                                  );
                                })}
                                {staff.length === 0 && (
                                  <p className="px-1 py-2 text-xs text-muted-foreground">No production staff found.</p>
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                          {(item.assignments?.length ?? 0) > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.assignments!.map((a) => (
                                <span
                                  key={a.id}
                                  className={`rounded px-1.5 py-0.5 text-[10px] ${a.completed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                                >
                                  {a.user?.name ?? `#${a.user_id}`}{a.completed ? " ✓" : ""}
                                </span>
                              ))}
                            </div>
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
