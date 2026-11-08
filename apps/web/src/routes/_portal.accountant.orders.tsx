import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersFilterBar, OrdersPager, parseOrdersSearch, useOrdersFilters } from "@/components/orders/OrdersListFilters";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchOrders, exportOrders } from "@/api/orders";
import { Globe, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_portal/accountant/orders")({
  head: () => ({ meta: [{ title: "Company Orders — SB OMS" }] }),
  validateSearch: parseOrdersSearch,
  component: AccountantOrders,
});

function AccountantOrders() {
  const filters = useOrdersFilters(Route.useSearch());
  const { params } = filters;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "accountant", params],
    queryFn: () => fetchOrders(params),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Company-Wide Orders"
        description="Global view of all orders across the company for auditing and oversight."
        crumbs={[{ label: "Accountant" }, { label: "All Orders" }]}
        actions={
          <Button variant="secondary" className="rounded-xl shadow-soft" onClick={() => exportOrders({})}>
            <Download className="mr-2 h-4 w-4" /> Export All
          </Button>
        }
      />
      
      <div className="mb-4 rounded-xl border border-info/40 bg-info/10 p-3 text-sm text-info-foreground">
        <Globe className="mr-2 inline h-4 w-4" />
        <span className="font-semibold">Global View:</span> You have read-only access to all orders across the company. To reconcile pending orders, please use the Billing Queue.
      </div>
      
      <OrdersFilterBar
        filters={filters}
        total={data?.pagination?.total || data?.orders?.length || 0}
        shown={data?.orders?.length || 0}
      />
      <OrdersTable
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        orders={data?.orders || []} 
        showCreator 
      />
      <OrdersPager filters={filters} total={data?.pagination?.total || 0} />
    </>
  );
}
