import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersFilterBar, parseOrdersSearch, useOrdersFilters } from "@/components/orders/OrdersListFilters";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchOrders, exportOrders } from "@/api/orders";

export const Route = createFileRoute("/_portal/employee/orders")({
  head: () => ({ meta: [{ title: "My Orders — SB OMS" }] }),
  validateSearch: parseOrdersSearch,
  component: MyOrders,
});

function MyOrders() {
  const filters = useOrdersFilters(Route.useSearch());
  const { section, debouncedQ, params } = filters;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "employee", params],
    queryFn: () => fetchOrders(params),
    placeholderData: keepPreviousData,
  });

  const handleExport = async () => {
    await exportOrders({ section, q: debouncedQ || undefined });
  };

  const orders = data?.orders || [];
  const total = data?.pagination?.total || orders.length;

  return (
    <>
      <PageHeader
        title="My Orders"
        description="All orders you originated, filtered server-side by your user ID."
        crumbs={[{ label: "Employee" }, { label: "My Orders" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-xl" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" /> Export {section === "active" ? "Active" : "Completed"}
            </Button>
            <Button variant="secondary" className="rounded-xl shadow-soft" onClick={() => exportOrders({})}>
              <Download className="mr-2 h-4 w-4" /> Export All
            </Button>
          </div>
        }
      />

      <OrdersFilterBar filters={filters} total={total} shown={orders.length} />
      <OrdersTable
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        orders={orders} 
        action={(o) => (
          <div className="flex justify-end gap-2">
            <Link to="/employee/orders/$id" params={{ id: String(o.id) }} className={buttonVariants({ size: "sm", variant: "ghost" })}>
              View
            </Link>
            {/* Header fields (store, location, PO) stay editable past billing, so the
                link follows the header rule, not the line-item one. */}
            {["Active", "Installed", "BillingCompleted", "Pending"].includes(o.status) && (
              <Link to="/employee/edit-order/$id" params={{ id: String(o.id) }} className={buttonVariants({ size: "sm", variant: "outline" })}>
                <Edit className="mr-1 h-3.5 w-3.5" /> {o.store_count === 0 ? "Add stores" : "Edit"}
              </Link>
            )}
          </div>
        )}
      />
    </>
  );
}
