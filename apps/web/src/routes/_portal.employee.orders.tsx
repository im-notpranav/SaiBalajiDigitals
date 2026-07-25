import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Filter, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders, exportOrders } from "@/api/orders";
import { ORDER_STATUSES } from "@/lib/constants";
import type { OrderStatus } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/employee/orders")({
  head: () => ({ meta: [{ title: "My Orders — SB OMS" }] }),
  component: MyOrders,
});

function MyOrders() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "employee", status, q],
    queryFn: () => {
      const params: any = {};
      if (status !== "all") params.status = status;
      if (q) params.client = q; // Simplistic search on client
      return fetchOrders(params);
    },
  });

  const handleExport = async () => {
    const params: any = {};
    if (status !== "all") params.status = status;
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
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by client name"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | "all")}>
          <SelectTrigger className="w-[200px]">
            <Filter className="mr-2 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          {total} orders found
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
      ) : (
        <OrdersTable orders={orders} detailBase="/employee/orders" />
      )}
    </>
  );
}
