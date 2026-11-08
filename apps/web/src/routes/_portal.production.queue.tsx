import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchOrders, completeOrderItem } from "@/api/orders";
import { CheckCircle2, Flag, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { Order, OrderItem } from "@sb-oms/shared-types";
import { storeLabel, storeSubLabel } from "@/lib/stores";

type QueueFilter = "all" | "todo" | "flagged" | "done";

const QUEUE_FILTERS: { key: QueueFilter; label: string; empty: string }[] = [
  { key: "all", label: "All", empty: "Nothing assigned to you right now" },
  { key: "todo", label: "To do", empty: "Nothing left to do. Well done." },
  { key: "flagged", label: "On hold", empty: "None of your items are on hold" },
  { key: "done", label: "Finished", empty: "You haven't finished any items on active orders yet" },
];

export const Route = createFileRoute("/_portal/production/queue")({
  head: () => ({ meta: [{ title: "Production Queue — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>): { filter?: QueueFilter } => ({
    filter: QUEUE_FILTERS.some((f) => f.key === search.filter) ? (search.filter as QueueFilter) : undefined,
  }),
  component: ProductionQueue,
});

function ProductionQueue() {
  const queryClient = useQueryClient();
  const { filter = "all" } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data, isLoading, error, refetch } = useQuery({
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
  // "Mine" is my own assignment on the item, which may differ from the item's overall completion.
  const isMineDone = (item: OrderItem) => item.my_assignment_completed ?? item.production_completed ?? false;
  const shows = (item: OrderItem) =>
    filter === "all" ||
    (filter === "todo" && !isMineDone(item)) ||
    (filter === "flagged" && !isMineDone(item) && !!item.is_flagged) ||
    (filter === "done" && isMineDone(item));
  const countOf = (key: QueueFilter) => {
    const all = orders.flatMap((o) => o.items ?? []);
    if (key === "todo") return all.filter((i) => !isMineDone(i)).length;
    if (key === "flagged") return all.filter((i) => !isMineDone(i) && i.is_flagged).length;
    if (key === "done") return all.filter(isMineDone).length;
    return all.length;
  };
  const shownItems = orders.flatMap((o) => o.items ?? []).filter(shows).length;

  /** The on-hold badge for a flagged item; shared by the phone list and the table. */
  const flagFor = (item: OrderItem) => (
    <>
      {item.is_flagged && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          <Flag className="h-3 w-3" /> Flagged — on hold
          {item.flag_reason && <span className="font-normal opacity-80">({item.flag_reason})</span>}
        </div>
      )}
    </>
  );

  /** Mark complete, or the done state with a reopen button. */
  const actionFor = (order: (typeof orders)[number], item: OrderItem) => (
    <>
      {isMineDone(item) ? (
        <div className="flex items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {item.production_completed ? "Complete" : "Done (mine)"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:h-7 md:w-7"
            title="Reopen"
            aria-label={`Reopen item ${item.s_no}, ${item.media}`}
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
    </>
  );

  return (
    <>
      <PageHeader
        title="My Production Queue"
        description="Line items assigned to you. Mark each one complete as you finish it."
        crumbs={[{ label: "Production", to: "/production/dashboard" }, { label: "Queue" }]}
      />

      {totalItems > 0 && (
        <div className="mb-4 inline-flex flex-wrap rounded-xl border p-1" role="group" aria-label="Show items">
          {QUEUE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => navigate({ search: { filter: f.key === "all" ? undefined : f.key }, replace: true })}
              className={
                filter === f.key
                  ? "min-h-9 rounded-lg bg-primary px-3 py-1 text-sm text-primary-foreground"
                  : "min-h-9 rounded-lg px-3 py-1 text-sm text-muted-foreground hover:bg-muted/50"
              }
            >
              {f.label} <span className="tabular-nums">({countOf(f.key)})</span>
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading your queue…" />
      ) : error && !data ? (
        <ErrorState title="Couldn't load your queue" error={error} onRetry={() => refetch()} />
      ) : shownItems === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={QUEUE_FILTERS.find((f) => f.key === filter)!.empty}
        />
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const allItems = order.items ?? [];
            const items = allItems.filter(shows);
            if (items.length === 0) return null;
            const done = allItems.filter(isMineDone).length;

            return (
              <section key={order.id} className="surface-panel p-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
                  <div>
                    <h3 className="font-semibold">
                      <Link
                        to="/production/orders/$id"
                        params={{ id: String(order.id) }}
                        className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {order.order_no}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {order.client_name} · {storeLabel(order as any)}{storeSubLabel(order as any) ? ` (${storeSubLabel(order as any)})` : ""}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <div className="uppercase tracking-wider text-muted-foreground">My items</div>
                    <div className="font-semibold">{done} of {allItems.length} complete</div>
                  </div>
                </div>

                {/* Phones: one row per item with the button full width under it. */}
                <ul className="divide-y md:hidden">
                  {items.map((item: OrderItem) => (
                    <li key={item.id} className="grid gap-2 p-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">{item.s_no}. </span>
                        <span className="font-medium">{item.media}</span>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {item.width_inches} x {item.height_inches} in · Qty {item.qty} · {(item.total_sft || 0).toFixed(2)} sft
                        </div>
                        {flagFor(item)}
                      </div>
                      <div className="flex justify-end [&>button]:h-11 [&>button]:w-full">{actionFor(order, item)}</div>
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
                        <TableHead className="text-right w-44">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item: OrderItem) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-center text-muted-foreground">{item.s_no}</TableCell>
                          <TableCell className="font-medium">
                            {item.media}
                            {flagFor(item)}
                          </TableCell>
                          <TableCell className="text-right">{item.width_inches} x {item.height_inches}</TableCell>
                          <TableCell className="text-right">{item.qty}</TableCell>
                          <TableCell className="text-right">{(item.total_sft || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {actionFor(order, item)}
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
