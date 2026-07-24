import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Users, Boxes, TrendingUp, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { APP_USERS, AUDIT, ORDERS, REVENUE_TREND, inr, type OrderStatus } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin Dashboard — SB OMS" }] }),
  component: AdminDashboard,
});

const PIPELINE: OrderStatus[] = ["pending", "in_production", "ready_to_bill", "billed", "closed"];

function AdminDashboard() {
  const totalRevenue = REVENUE_TREND.reduce((s, r) => s + r.revenue, 0);
  const activeUsers = APP_USERS.filter((u) => u.status === "active").length;
  const openAlerts = 3;

  return (
    <>
      <PageHeader
        title="Administrator Dashboard"
        description="Full oversight across every portal — orders, users, audit, alerts."
        crumbs={[{ label: "Administrator" }, { label: "Dashboard" }]}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Orders" value={ORDERS.length} icon={Boxes} accent="primary" delay={0} />
        <KpiCard label="Active Users" value={activeUsers} icon={Users} accent="info" delay={0.05} />
        <KpiCard label="FY Revenue" value={inr(totalRevenue)} icon={TrendingUp} accent="success" delay={0.1} trend={{ value: "+18.2%", positive: true }} />
        <KpiCard label="Open Alerts" value={openAlerts} icon={AlertTriangle} accent="warning" delay={0.15} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-8 grid gap-6 lg:grid-cols-3"
      >
        <div className="surface-panel p-6 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold">Revenue trend</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={REVENUE_TREND}>
                <defs>
                  <linearGradient id="rev2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                <Tooltip
                  contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }}
                  formatter={(v: number) => inr(v)}
                />
                <Area type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#rev2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-panel p-6">
          <h3 className="mb-4 text-sm font-semibold">Pipeline snapshot</h3>
          <div className="space-y-3">
            {PIPELINE.map((s) => {
              const count = ORDERS.filter((o) => o.status === s).length;
              const pct = (count / ORDERS.length) * 100;
              return (
                <div key={s}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <StatusBadge status={s} />
                    <span className="font-semibold">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-8 grid gap-6 lg:grid-cols-3"
      >
        <div className="surface-panel p-6 lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" /> Recent audit activity
          </h3>
          <div className="space-y-2">
            {AUDIT.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-sm">
                <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-center text-xs font-bold leading-8 text-primary">
                  {a.actor.split(" ").map((n) => n[0]).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="font-semibold">{a.actor}</span>{" "}
                    <span className="text-muted-foreground">· {a.detail}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.role} · <span className="font-mono">{a.target}</span> · {a.action}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-panel p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-warning" /> Alerts
          </h3>
          <ul className="space-y-3 text-sm">
            <Alert kind="warning" title="FY rollover due" body="Rollover scheduled 01 May 2027 — verify sequence config." />
            <Alert kind="info" title="Sequence anomaly" body="Gap between ORD261021 and ORD261024 detected." />
            <Alert kind="warning" title="Delayed orders" body="4 orders in production >72h." />
          </ul>
        </div>
      </motion.div>
    </>
  );
}

function Alert({ kind, title, body }: { kind: "warning" | "info"; title: string; body: string }) {
  const cls =
    kind === "warning"
      ? "border-warning/30 bg-warning/5"
      : "border-info/30 bg-info/5";
  return (
    <li className={`rounded-lg border p-3 ${cls}`}>
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground">{body}</div>
    </li>
  );
}
