import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { fetchOrders, assignOrderItem } from "@/api/orders";
import { fetchProductionStaff } from "@/api/users";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Flag, Search, Users, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { FilterChip } from "@/components/dashboard/DashboardBits";
import { StatusBadge } from "@/components/orders/StatusBadge";
import type { Order, OrderItem } from "@sb-oms/shared-types";
import { storeLabel, storeSubLabel } from "@/lib/stores";

type AssignFilter = "unassigned" | "flagged";

export const Route = createFileRoute("/_portal/prod-manager/assign")({
  head: () => ({ meta: [{ title: "Assign Work — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>): { order?: number; filter?: AssignFilter } => {
    const order = Number(search.order);
    return {
      order: Number.isInteger(order) && order > 0 ? order : undefined,
      filter: search.filter === "unassigned" || search.filter === "flagged" ? search.filter : undefined,
    };
  },
  component: ProdManagerAssignPage,
});

/** The most the orders API returns at once. */
const ORDER_LIMIT = 200;

function ProdManagerAssignPage() {
  const queryClient = useQueryClient();
  const { order: orderId, filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "prod-manager"],
    queryFn: () => fetchOrders({ limit: ORDER_LIMIT, items: "full" }),
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

  const allOrders: Order[] = data?.orders ?? [];
  const term = q.trim().toLowerCase();
  const itemShows = (item: OrderItem) =>
    filter === "unassigned"
      ? !item.production_completed && (item.assignments?.length ?? 0) === 0
      : filter === "flagged"
        ? !!item.is_flagged
        : true;
  const orders = allOrders.filter(
    (o) =>
      (!orderId || o.id === orderId) &&
      // Active only, the same orders the dashboard counted when it linked here.
      (!filter || (o.status === "Active" && (o.items ?? []).some(itemShows))) &&
      (!term || o.order_no.toLowerCase().includes(term) || o.client_name.toLowerCase().includes(term)),
  );
  const narrowed = !!orderId || !!filter || !!term;
  const focused = orderId ? allOrders.find((o) => o.id === orderId) : undefined;

  /** Where one item stands; shared by the phone list and the table. */
  const statusFor = (item: OrderItem) => (
    <>
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
    </>
  );

  /** The team picker and assigned names for one item. */
  const assignFor = (order: (typeof orders)[number], item: OrderItem) => (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full justify-between text-xs font-normal md:h-8"
            disabled={assignMutation.isPending}
            aria-label={`Assign teams to item ${item.s_no}, ${item.media}`}
          >
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
    </>
  );

  return (
    <>
      <PageHeader
        title="Assign Work"
        description="Assign each line item to a production employee. An order can only be billed once every assigned item is complete."
        crumbs={[{ label: "Production Manager", to: "/prod-manager/dashboard" }, { label: "Assign Work" }]}
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search by order number or client"
            placeholder="Order number or client"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show orders with">
          {(["unassigned", "flagged"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() =>
                navigate({ search: { order: orderId, filter: filter === f ? undefined : f }, replace: true })
              }
              className={
                filter === f
                  ? "h-9 rounded-md border border-primary bg-primary/10 px-3 text-xs font-medium text-primary"
                  : "h-9 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-muted/50"
              }
            >
              {f === "unassigned" ? "Has unassigned items" : "Has flagged items"}
            </button>
          ))}
          {orderId && (
            <FilterChip
              label={focused ? `Only ${focused.order_no}` : "One order"}
              onClear={() => navigate({ search: { filter }, replace: true })}
            />
          )}
        </div>
        <div className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
          {orders.length} of {data?.pagination?.total ?? allOrders.length} orders
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading orders…" />
      ) : error && !data ? (
        <ErrorState title="Couldn't load orders" error={error} onRetry={() => refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={narrowed ? "No orders match" : "No active orders to assign"}
          description={narrowed ? "Clear the search or filters above to see every order." : undefined}
        />
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const items = order.items ?? [];
            const assigned = items.filter((i) => (i.assignments?.length ?? 0) > 0);
            const done = assigned.filter((i) => i.production_completed).length;

            return (
              <section key={order.id} className="surface-panel p-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
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

                {/* Phones: one row per item instead of a seven-column table per order. */}
                <ul className="divide-y md:hidden">
                  {items.map((item: OrderItem) => (
                    <li key={item.id} className="grid gap-2 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-muted-foreground">{item.s_no}. </span>
                          <span className="font-medium">{item.media}</span>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {item.width_inches} x {item.height_inches} in · Qty {item.qty} · {(item.total_sft || 0).toFixed(2)} sft
                          </div>
                        </div>
                        <div className="shrink-0">{statusFor(item)}</div>
                      </div>
                      <div>{assignFor(order, item)}</div>
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block">
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
                            {statusFor(item)}
                          </TableCell>
                          <TableCell>
                            {assignFor(order, item)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
