import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { REVENUE_TREND, inr, ORDERS } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/admin/reports")({
  head: () => ({ meta: [{ title: "System Reports — SB OMS" }] }),
  component: () => {
    const revenue = REVENUE_TREND.reduce((s, r) => s + r.revenue, 0);
    return (
      <>
        <PageHeader title="System Reports" description="Cross-portal reporting for administrators." crumbs={[{ label: "Administrator" }, { label: "Reports" }]} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Orders" value={ORDERS.length} accent="primary" />
          <KpiCard label="Revenue" value={inr(revenue)} accent="success" />
          <KpiCard label="Closure rate" value="87%" accent="info" />
          <KpiCard label="Avg cycle time" value="4.2 days" accent="orange" />
        </div>
        <div className="surface-panel mt-8 p-6">
          <h3 className="mb-4 text-sm font-semibold">Orders by month</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={REVENUE_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="orders" fill="var(--color-brand-orange)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </>
    );
  },
});
