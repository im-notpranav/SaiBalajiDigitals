import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { fetchOrders } from "@/api/orders";
import { fetchProductionStaff } from "@/api/users";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Search } from "lucide-react";
import { FilterChip } from "@/components/dashboard/DashboardBits";
import type { Order, OrderItem } from "@sb-oms/shared-types";
import { AssignOrderSection } from "@/components/orders/AssignOrderSection";

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
  const { order: orderId, filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState("");
  /** The order whose items are ticked; ticking in another order starts over there. */
  const [activeOrder, setActiveOrder] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "prod-manager"],
    queryFn: () => fetchOrders({ limit: ORDER_LIMIT, items: "full" }),
  });

  const { data: staffData } = useQuery({
    queryKey: ["production-staff"],
    queryFn: fetchProductionStaff,
  });

  const staff = staffData?.users ?? [];

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

  return (
    <>
      <PageHeader
        title="Assign Work"
        description="Tick items, pick teams, assign in one go."
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
          {orders.map((order) => (
            <AssignOrderSection
              key={order.id}
              order={order}
              staff={staff}
              active={activeOrder === order.id}
              onActivate={() => setActiveOrder(order.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}
