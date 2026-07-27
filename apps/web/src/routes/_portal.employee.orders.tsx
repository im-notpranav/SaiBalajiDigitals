import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Download, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders, exportOrders } from "@/api/orders";
import { useAuth } from "@/lib/auth-store";
import { useDebounce } from "@/hooks/use-debounce";

export const Route = createFileRoute("/_portal/employee/orders")({
  head: () => ({ meta: [{ title: "My Orders — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
  }),
  component: MyOrders,
});

function MyOrders() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q || "");
  const [searchField, setSearchField] = useState<"client" | "store" | "order_no">("client");
  const debouncedQ = useDebounce(q, 300);
  const [section, setSection] = useState<"active" | "completed">("active");

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "employee", section, searchField, debouncedQ],
    queryFn: () => {
      const params: any = { section };
      if (debouncedQ) params[searchField] = debouncedQ;
      return fetchOrders(params);
    },
  });

  const handleExport = async () => {
    const params: any = { section };
    if (q) params[searchField] = q;
    await exportOrders(params);
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
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" /> Export {section === "active" ? "Active" : "Completed"}
            </Button>
            <Button variant="secondary" className="rounded-xl shadow-soft" onClick={() => exportOrders({})}>
              <Download className="mr-2 h-4 w-4" /> Export All
            </Button>
          </div>
        }
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as "active" | "completed")} className="w-[300px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex flex-1 items-center gap-2">
          <Select value={searchField} onValueChange={(v: any) => setSearchField(v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Client Name</SelectItem>
              <SelectItem value="store">Store Name</SelectItem>
              <SelectItem value="order_no">Order No</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search by ${searchField === 'client' ? 'client name' : searchField === 'store' ? 'store name' : 'order number'}...`}
              className="pl-9"
            />
          </div>
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {total} orders found
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
      ) : (
        <OrdersTable 
          orders={orders} 
          action={(o) => (
            <div className="flex justify-end gap-2">
              <Link to="/employee/orders/$id" params={{ id: String(o.id) }} className={buttonVariants({ size: "sm", variant: "ghost" })} onClick={() => console.log("VIEW CLICKED", o.id)}>
                View
              </Link>
              {o.status === "Active" && (
                <Link to="/employee/edit-order/$id" params={{ id: String(o.id) }} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  <Edit className="mr-1 h-3.5 w-3.5" /> Edit
                </Link>
              )}
            </div>
          )}
        />
      )}
    </>
  );
}
