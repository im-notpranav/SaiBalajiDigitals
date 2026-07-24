import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Factory, Timer, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { ORDERS, ordersByStatus, type OrderStatus } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/production/dashboard")({
  head: () => ({ meta: [{ title: "Production Dashboard — SB OMS" }] }),
  component: ProductionDashboard,
});

const KANBAN: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Queued" },
  { status: "in_production", label: "In Production" },
  { status: "ready_to_bill", label: "Ready to Bill" },
];

function ProductionDashboard() {
  const total = ordersByStatus("pending").length + ordersByStatus("in_production").length;
  const today = ORDERS.filter((o) => o.ageHours < 24 && (o.status === "pending" || o.status === "in_production")).length;
  const delayed = ORDERS.filter((o) => o.ageHours > 72 && o.status === "in_production").length;
  const ready = ordersByStatus("ready_to_bill").length;

  return (
    <>
      <PageHeader
        title="Production Dashboard"
        description="Move orders through production stages. Backend enforces valid next actions."
        crumbs={[{ label: "Production" }, { label: "Dashboard" }]}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active workload" value={total} icon={Factory} accent="info" delay={0} />
        <KpiCard label="Today's work" value={today} icon={Timer} accent="primary" delay={0.05} />
        <KpiCard label="Delayed (>72h)" value={delayed} icon={AlertTriangle} accent="warning" delay={0.1} />
        <KpiCard label="Ready to bill" value={ready} icon={CheckCircle2} accent="success" delay={0.15} />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {KANBAN.map((col, ci) => {
          const items = ordersByStatus(col.status).slice(0, 6);
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
                  <div className="text-xs text-muted-foreground">{items.length} orders</div>
                </div>
                <StatusBadge status={col.status} />
              </div>
              <div className="flex-1 space-y-2 p-3">
                {items.map((o) => (
                  <div
                    key={o.id}
                    className="group cursor-pointer rounded-xl border bg-background p-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs font-semibold text-primary">{o.number}</div>
                      <span
                        className={
                          o.priority === "high"
                            ? "rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive"
                            : o.priority === "medium"
                              ? "rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground"
                              : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                        }
                      >
                        {o.priority}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">{o.customer}</div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{o.items.length} items</span>
                      <span className={o.ageHours > 72 ? "font-semibold text-warning-foreground" : ""}>
                        {o.ageHours}h in stage
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
