import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { ORDERS, type OrderStatus } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/employee/orders")({
  head: () => ({ meta: [{ title: "My Orders — SB OMS" }] }),
  component: MyOrders,
});

function MyOrders() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");

  const filtered = useMemo(() => {
    return ORDERS.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (q && !`${o.number} ${o.customer}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [q, status]);

  return (
    <>
      <PageHeader
        title="My Orders"
        description="All orders you originated, filtered server-side by your user ID."
        crumbs={[{ label: "Employee" }, { label: "My Orders" }]}
        actions={
          <Button variant="outline" className="rounded-xl">
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
            placeholder="Search by order # or customer"
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
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_production">In Production</SelectItem>
            <SelectItem value="ready_to_bill">Ready to Bill</SelectItem>
            <SelectItem value="billed">Billed</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {ORDERS.length} orders
        </div>
      </div>

      <OrdersTable orders={filtered} detailBase="/employee/orders" />
    </>
  );
}
