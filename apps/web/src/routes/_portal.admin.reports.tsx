import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "@/api/dashboard";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_portal/admin/reports")({
  head: () => ({ meta: [{ title: "System Reports — SB OMS" }] }),
  component: AdminReports,
});

function AdminReports() {
  const { data: dash, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const revenue = dash?.total_revenue || 0;
  
  return (
    <>
      <PageHeader title="System Reports" description="Cross-portal reporting for administrators." crumbs={[{ label: "Administrator" }, { label: "Reports" }]} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Orders" value={dash?.total_orders || 0} accent="primary" />
        <KpiCard label="Revenue" value={inr(revenue)} accent="success" />
        <KpiCard label="Closure rate" value="87%" accent="info" />
        <KpiCard label="Avg cycle time" value="4.2 days" accent="orange" />
      </div>
      <div className="surface-panel mt-8 p-6">
        <h3 className="mb-4 text-sm font-semibold">Orders by month</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dash?.revenue_trend || []}>
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
}
