import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Download, Edit } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders, exportOrders } from "@/api/orders";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/employee/orders")({
  head: () => ({ meta: [{ title: "My Orders — SB OMS" }] }),
  component: MyOrders,
});

function MyOrders() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [section, setSection] = useState<"active" | "completed">("active");

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "employee", section, q],
    queryFn: () => {
      const params: any = { section };
      if (q) params.client = q;
      return fetchOrders(params);
    },
  });

  const handleExport = async () => {
    const params: any = { section };
    if (q) params.client = q;
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
          <Button variant="outline" className="rounded-xl" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        }
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as "active" | "completed")} className="w-[300px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by client name"
            className="pl-9"
          />
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
          detailBase="/employee/orders" 
          action={(o) => (
            <div className="flex justify-end gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link to="/employee/orders/$id" params={{ id: String(o.id) }}>
                  View
                </Link>
              </Button>
              {o.status === "Active" && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/employee/edit-order/$id" params={{ id: String(o.id) }}>
                    <Edit className="mr-1 h-3.5 w-3.5" /> Edit
                  </Link>
                </Button>
              )}
            </div>
          )}
        />
      )}
    </>
  );
}
