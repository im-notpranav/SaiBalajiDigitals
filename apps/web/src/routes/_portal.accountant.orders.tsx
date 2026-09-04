import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders, exportOrders } from "@/api/orders";
import { Globe, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_portal/accountant/orders")({
  head: () => ({ meta: [{ title: "Company Orders — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
  }),
  component: AccountantOrders,
});

function AccountantOrders() {
  const search = Route.useSearch();
  const [section, setSection] = useState<"active" | "completed">("active");
  const [q, setQ] = useState(search.q || "");
  const [searchField, setSearchField] = useState<"client" | "store" | "order_no">("client");
  const debouncedQ = useDebounce(q, 300);

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "accountant", section, searchField, debouncedQ],
    queryFn: () => {
      const params: any = { section };
      if (debouncedQ) params[searchField] = debouncedQ;
      return fetchOrders(params);
    },
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
      
      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as "active" | "completed")} className="w-full sm:w-[300px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex w-full min-w-0 flex-1 items-center gap-2 sm:w-auto">
          <Select value={searchField} onValueChange={(v: any) => setSearchField(v)}>
            <SelectTrigger className="w-[120px] shrink-0 sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Client Name</SelectItem>
              <SelectItem value="store">Store Name</SelectItem>
              <SelectItem value="order_no">Order No</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="relative min-w-0 flex-1 sm:min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search by ${searchField === 'client' ? 'client name' : searchField === 'store' ? 'store name' : 'order number'}...`}
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
          {data?.pagination?.total || data?.orders?.length || 0} orders found
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
      ) : (
        <OrdersTable 
          orders={data?.orders || []} 
          showCreator 
        />
      )}
    </>
  );
}
