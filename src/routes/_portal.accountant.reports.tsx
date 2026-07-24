import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Button } from "@/components/ui/button";
import { REVENUE_TREND, inr, ORDERS } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/accountant/reports")({
  head: () => ({ meta: [{ title: "Financial Reports — SB OMS" }] }),
  component: Reports,
});

function Reports() {
  const revenue = REVENUE_TREND.reduce((s, r) => s + r.revenue, 0);
  const orders = REVENUE_TREND.reduce((s, r) => s + r.orders, 0);
  const totalSft = ORDERS.reduce((s, o) => s + o.sft, 0);
  const avg = revenue / orders;

  return (
    <>
      <PageHeader
        title="Financial Reports"
        description="Aggregated over generated columns — no client-side money recomputation."
        crumbs={[{ label: "Accountant" }, { label: "Reports" }]}
        actions={
          <>
            <Button variant="outline" className="rounded-xl"><Download className="mr-2 h-4 w-4" /> Excel</Button>
            <Button variant="outline" className="rounded-xl"><Download className="mr-2 h-4 w-4" /> PDF</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="FY Revenue" value={inr(revenue)} accent="success" delay={0} />
        <KpiCard label="Total Orders" value={orders} accent="primary" delay={0.05} />
        <KpiCard label="Avg Order Value" value={inr(avg)} accent="info" delay={0.1} />
        <KpiCard label="Total Sft" value={totalSft.toLocaleString()} accent="orange" delay={0.15} />
      </div>

      <div className="surface-panel mt-8 p-6">
        <h3 className="mb-4 text-sm font-semibold">Revenue by month</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={REVENUE_TREND}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
              <Tooltip
                contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }}
                formatter={(v: number) => inr(v)}
              />
              <Bar dataKey="revenue" fill="var(--color-primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
