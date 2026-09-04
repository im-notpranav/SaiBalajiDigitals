import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Factory, Timer, Receipt, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "@/api/dashboard";
import { fetchOrders } from "@/api/orders";
import type { OrderStatus, Order } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/production/dashboard")({
  head: () => ({ meta: [{ title: "Production Dashboard — SB OMS" }] }),
  component: ProductionDashboard,
});

const KANBAN: { status: OrderStatus; label: string }[] = [
  { status: "Active", label: "In Production" },
];

function ProductionDashboard() {
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const { data: ordersData } = useQuery({ queryKey: ["orders", "Active"], queryFn: () => fetchOrders({ status: "Active", limit: 50 }) });

  const active = dash?.active_orders || 0;
  const pending = dash?.pending_orders || 0;
  const completed = dash?.completed_orders || 0;
  const total = dash?.total_orders || 0;
  
  const allOrders = ordersData?.orders || [];

  return (
    <>
      <PageHeader
        title="Production Dashboard"
        description="Move orders through production stages. Backend enforces valid next actions."
        crumbs={[{ label: "Production" }, { label: "Dashboard" }]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active Workload" value={active} icon={Factory} accent="info" delay={0} />
        <KpiCard label="Pending Billing" value={pending} icon={Receipt} accent="warning" delay={0.05} />
        <KpiCard label="Completed" value={completed} icon={CheckCircle2} accent="success" delay={0.1} />
        <KpiCard label="Total Orders" value={total} icon={Timer} accent="primary" delay={0.15} />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-1">
        {KANBAN.map((col, ci) => {
          const items = allOrders.filter((o: Order) => o.status === col.status).slice(0, 8);
          return (
            <motion.div
              key={col.status}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + ci * 0.06 }}
              className="surface-panel flex min-h-[400px] flex-col"
            >
              <div className="flex items-center justify-between border-b p-4">
                <div>
                  <div className="text-sm font-semibold">{col.label}</div>
                  <div className="text-xs text-muted-foreground">{items.length} recent orders</div>
                </div>
                <StatusBadge status={col.status} />
              </div>
              <div className="flex-1 space-y-2 p-3">
                {items.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">No orders</div>
                ) : items.map((o: Order) => (
                  <div
                    key={o.id}
                    className="group cursor-pointer rounded-xl border bg-background p-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs font-semibold text-primary">{o.order_no}</div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        Normal
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">{o.client_name}</div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{o.items.length} items</span>
                      <span>
                        {new Date(o.date || "").toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}
