import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Receipt, Wallet, Calendar, TrendingUp } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { REVENUE_TREND } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "@/api/dashboard";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_portal/accountant/dashboard")({
  head: () => ({ meta: [{ title: "Accountant Dashboard — SB OMS" }] }),
  component: AccountantDashboard,
});

function AccountantDashboard() {
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });

  const pendingBilling = dash?.pending_orders || 0;
  const awaitingClosure = dash?.completed_orders || 0;
  const fyRevenue = dash?.total_revenue || 0;

  return (
    <>
      <PageHeader
        title="Accountant Dashboard"
        description="Billing, closure and financial-year oversight for FY 2026-27."
        crumbs={[{ label: "Accountant" }, { label: "Dashboard" }]}
        actions={
          <Button asChild className="rounded-xl">
            <Link to="/accountant/billing">
              <Receipt className="mr-2 h-4 w-4" /> Open Billing Queue
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Pending Billing" value={pendingBilling} icon={Receipt} accent="primary" delay={0} />
        <KpiCard label="Awaiting Closure" value={awaitingClosure} icon={Wallet} accent="warning" delay={0.05} />
        <KpiCard label="Total Revenue" value={inr(fyRevenue)} icon={TrendingUp} accent="success" delay={0.1} />
        <KpiCard label="Next Rollover" value="30 Apr" icon={Calendar} accent="orange" delay={0.15} hint="On track" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-8 grid gap-6 lg:grid-cols-3"
      >
        <div className="surface-panel p-6 lg:col-span-2">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h3 className="text-sm font-semibold">Revenue trend</h3>
              <p className="text-xs text-muted-foreground">Last 6 months across all portals.</p>
            </div>
            <div className="text-2xl font-bold">{inr(fyRevenue)}</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={REVENUE_TREND}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => inr(v)}
                />
                <Area type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="surface-panel p-6">
          <h3 className="mb-4 text-sm font-semibold">Financial Year</h3>
          <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-transparent to-brand-orange/10 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Active FY</div>
            <div className="mt-1 text-2xl font-bold">FY 2026-27</div>
            <div className="mt-1 text-xs text-muted-foreground">01 May 2026 → 30 Apr 2027</div>
            <div className="mt-4 space-y-2 text-xs">
              <Row label="Sequence prefix" value="ORD26" />
              <Row label="Current sequence" value="ORD261042" />
              <Row label="Last rollover" value="01 May 2026 · success" />
              <Row label="Next rollover" value="01 May 2027" />
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}
