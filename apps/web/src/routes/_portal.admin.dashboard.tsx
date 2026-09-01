import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import {
  Factory,
  PackageCheck,
  Receipt,
  CreditCard,
  CheckCircle2,
  CalendarIcon,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Clock,
  AlertTriangle,
  IndianRupee,
  Hash,
  Users,
  TrendingUp,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { fetchCsmDashboard, fetchAdminDashboard } from "@/api/dashboard";
import { fetchUsers } from "@/api/users";
import type { CsmStageOrder, CsmCompletedOrder } from "@/api/dashboard";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_portal/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin Dashboard — SB OMS" }] }),
  component: AdminDashboard,
});

const STAGE_CONFIG = [
  { key: "production", label: "Production", icon: Factory, accent: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { key: "installation", label: "Installation", icon: PackageCheck, accent: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { key: "billing", label: "Billing", icon: Receipt, accent: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "payment", label: "Payment", icon: CreditCard, accent: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { key: "completed", label: "Completed", icon: CheckCircle2, accent: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
] as const;

function agingLevel(days: number): "normal" | "warning" | "severe" {
  if (days > 7) return "severe";
  if (days > 3) return "warning";
  return "normal";
}

function AgingBadge({ days }: { days: number }) {
  const level = agingLevel(days);
  return (
    <Badge
      className={cn(
        "gap-1 font-mono text-[11px]",
        level === "severe" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
        level === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        level === "normal" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
      variant="outline"
    >
      {level === "severe" && <AlertTriangle className="h-3 w-3" />}
      {level === "warning" && <Clock className="h-3 w-3" />}
      {days}d
    </Badge>
  );
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function AdminDashboard() {
  const now = new Date();
  // A rolling window, not the calendar month: an order dated last month can
  // still be in flight today, and on the 1st a month-to-date window is empty
  // by construction.
  const [from, setFrom] = useState<Date>(subDays(now, 90));
  const [to, setTo] = useState<Date>(now);
  const [viewMode, setViewMode] = useState<"amount" | "qty">("amount");
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const fromStr = format(from, "yyyy-MM-dd");
  const toStr = format(to, "yyyy-MM-dd");

  const { data: dash, isLoading } = useQuery({
    queryKey: ["csm-dashboard", "admin", fromStr, toStr],
    queryFn: () => fetchCsmDashboard(fromStr, toStr),
  });

  const { data: adminDash } = useQuery({ queryKey: ["adminDashboard"], queryFn: fetchAdminDashboard });
  const { data: usersData } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  const stageOrders = dash?.stage_orders;

  // Payment overdue: orders in payment stage with >7 business days since billing
  const overduePayments = useMemo(() => {
    if (!stageOrders?.payment) return [];
    return stageOrders.payment.filter((o) => o.days_in_stage > 7).sort((a, b) => b.days_in_stage - a.days_in_stage);
  }, [stageOrders?.payment]);

  const activeUsers = usersData?.users?.filter((u: any) => {
    if (!u.last_login_at) return false;
    const diff = Date.now() - new Date(u.last_login_at).getTime();
    return diff < 30 * 24 * 60 * 60 * 1000;
  }).length || 0;

  return (
    <>
      <PageHeader
        title="Administrator Dashboard"
        description="Full oversight across every portal — pipeline, revenue, and TAT."
        crumbs={[{ label: "Administrator" }, { label: "Dashboard" }]}
      />

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(from, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={from} onSelect={(d) => { if (d) { setFrom(d); setFromOpen(false); } }} defaultMonth={from} />
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground">to</span>
          <Popover open={toOpen} onOpenChange={setToOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <CalendarIcon className="h-3.5 w-3.5" />
                {format(to, "dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={to} onSelect={(d) => { if (d) { setTo(d); setToOpen(false); } }} defaultMonth={to} />
            </PopoverContent>
          </Popover>
        </div>

        <div className="h-6 w-px bg-border" />

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "amount" | "qty")}>
          <TabsList className="h-8">
            <TabsTrigger value="amount" className="gap-1 text-xs px-3">
              <IndianRupee className="h-3 w-3" /> Amount
            </TabsTrigger>
            <TabsTrigger value="qty" className="gap-1 text-xs px-3">
              <Hash className="h-3 w-3" /> Quantity
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading dashboard data...</div>
      ) : !dash ? (
        <div className="p-12 text-center text-muted-foreground">No data available.</div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <KpiCard label="Total Orders" value={dash.summary.total_orders} icon={Factory} accent="primary" delay={0} />
            <KpiCard
              label={viewMode === "amount" ? "Total Amount" : "Total Quantity"}
              value={viewMode === "amount" ? formatCurrency(dash.summary.total_amount) : dash.summary.total_qty}
              icon={viewMode === "amount" ? IndianRupee : Hash}
              accent="success"
              delay={0.05}
            />
            <KpiCard
              label="Open Orders"
              value={dash.summary.total_orders - (dash.stages.completed?.count ?? 0)}
              icon={Clock}
              accent="warning"
              delay={0.1}
              hint="Currently in pipeline"
            />
            <KpiCard label="Active Users" value={activeUsers} icon={Users} accent="info" delay={0.15} />
            <KpiCard
              label="Avg Close Time"
              value={`${adminDash?.averageTimeToClose || 0}h`}
              icon={TrendingUp}
              accent="orange"
              delay={0.2}
            />
          </div>

          {/* Pipeline stage cards */}
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">Pipeline Stages</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {STAGE_CONFIG.map((stage, i) => {
                const data = dash.stages[stage.key];
                const isExpanded = expandedStage === stage.key;
                const Icon = stage.icon;
                return (
                  <motion.button
                    key={stage.key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i, duration: 0.4 }}
                    onClick={() => setExpandedStage(isExpanded ? null : stage.key)}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border p-4 text-left transition-all hover:shadow-md",
                      isExpanded ? `${stage.border} ${stage.bg} shadow-md` : "bg-card hover:-translate-y-0.5",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className={cn("rounded-lg p-1.5", stage.bg)}>
                        <Icon className={cn("h-4 w-4", stage.accent)} />
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                    <div className="mt-3 text-2xl font-bold tabular-nums">{data?.count ?? 0}</div>
                    <div className="text-xs text-muted-foreground">{stage.label}</div>
                    <div className="mt-1 text-xs font-medium tabular-nums">
                      {viewMode === "amount"
                        ? formatCurrency(data?.amount ?? 0)
                        : `${data?.qty ?? 0} qty`}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Drill-down panel */}
          {expandedStage && stageOrders && (
            <motion.div
              key={expandedStage}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4"
            >
              {expandedStage === "completed" ? (
                <CompletedDrillDown orders={stageOrders.completed} viewMode={viewMode} />
              ) : (
                <OpenStageDrillDown
                  stage={expandedStage}
                  orders={stageOrders[expandedStage as keyof typeof stageOrders] as CsmStageOrder[]}
                  viewMode={viewMode}
                />
              )}
            </motion.div>
          )}

          {/* Payment overdue section */}
          {overduePayments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-8"
            >
              <div className="rounded-xl border border-red-500/20 overflow-hidden">
                <div className="bg-red-500/10 px-4 py-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="font-semibold text-sm text-red-700 dark:text-red-400">Payment Overdue</span>
                  <Badge variant="destructive" className="ml-auto text-xs">{overduePayments.length} orders</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client / Store</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                          {viewMode === "amount" ? "Amount" : "Qty"}
                        </th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Overdue</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {overduePayments.map((o) => (
                        <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs font-medium">{o.order_no}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-xs">{o.client_name}</div>
                            <div className="text-[11px] text-muted-foreground">{o.store_name}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                            {viewMode === "amount" ? formatCurrency(o.total_amount) : o.total_qty}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <AgingBadge days={o.days_in_stage} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                              <Link to="/admin/orders/$id" params={{ id: String(o.id) }}>
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* Revenue trend + Performance */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-8 grid gap-6 lg:grid-cols-3"
          >
            <div className="surface-panel p-6 lg:col-span-2">
              <h3 className="mb-4 text-sm font-semibold">Revenue trend (last 7 days)</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={adminDash?.revenueTrend || []}>
                    <defs>
                      <linearGradient id="rev2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
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
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" /> Performance Leaderboard
              </h3>
              <ul className="space-y-3 text-sm">
                {adminDash?.performanceLeaderboard?.map((l: any, i: number) => (
                  <li key={i} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <div className="font-semibold">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.ordersCompleted} orders</div>
                    </div>
                    <div className="font-bold text-success">{inr(l.revenueGenerated)}</div>
                  </li>
                ))}
                {(!adminDash?.performanceLeaderboard || adminDash.performanceLeaderboard.length === 0) && (
                  <div className="text-sm text-muted-foreground">No data available</div>
                )}
              </ul>
            </div>
          </motion.div>
        </>
      )}
    </>
  );
}

function OpenStageDrillDown({ stage, orders, viewMode }: { stage: string; orders: CsmStageOrder[]; viewMode: "amount" | "qty" }) {
  const config = STAGE_CONFIG.find((s) => s.key === stage)!;
  const sorted = useMemo(() => [...orders].sort((a, b) => b.days_in_stage - a.days_in_stage), [orders]);

  if (sorted.length === 0) {
    return (
      <div className={cn("rounded-xl border p-6 text-center text-sm text-muted-foreground", config.border, config.bg)}>
        No orders in this stage for the selected date range.
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border overflow-hidden", config.border)}>
      <div className={cn("px-4 py-3 flex items-center gap-2", config.bg)}>
        <config.icon className={cn("h-4 w-4", config.accent)} />
        <span className="font-semibold text-sm">{config.label}</span>
        <Badge variant="secondary" className="ml-auto text-xs">{sorted.length} orders</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client / Store</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                {viewMode === "amount" ? "Amount" : "Qty"}
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Days in Stage</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs font-medium">{o.order_no}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-xs">{o.client_name}</div>
                  <div className="text-[11px] text-muted-foreground">{o.store_name}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                  {viewMode === "amount" ? formatCurrency(o.total_amount) : o.total_qty}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <AgingBadge days={o.days_in_stage} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                    <Link to="/admin/orders/$id" params={{ id: String(o.id) }}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompletedDrillDown({ orders, viewMode }: { orders: CsmCompletedOrder[]; viewMode: "amount" | "qty" }) {
  const sorted = useMemo(() => [...orders].sort((a, b) => b.total_days - a.total_days), [orders]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center text-sm text-muted-foreground">
        No completed orders in the selected date range.
      </div>
    );
  }

  const avgTat = {
    production: avg(sorted.map((o) => o.production_days)),
    installation: avg(sorted.map((o) => o.installation_days)),
    billing: avg(sorted.map((o) => o.billing_days)),
    payment: avg(sorted.map((o) => o.payment_days)),
    total: avg(sorted.map((o) => o.total_days)),
  };

  return (
    <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
      <div className="bg-emerald-500/10 px-4 py-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span className="font-semibold text-sm">Completed Orders — TAT Breakdown</span>
        <Badge variant="secondary" className="ml-auto text-xs">{sorted.length} orders</Badge>
      </div>

      <div className="grid grid-cols-5 gap-px bg-border">
        {[
          { label: "Production", val: avgTat.production },
          { label: "Installation", val: avgTat.installation },
          { label: "Billing", val: avgTat.billing },
          { label: "Payment", val: avgTat.payment },
          { label: "Total", val: avgTat.total },
        ].map((item) => (
          <div key={item.label} className="bg-card px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
            <div className="mt-0.5 text-sm font-bold tabular-nums">
              {item.val !== null ? `${item.val}d` : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">avg</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                {viewMode === "amount" ? "Amount" : "Qty"}
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Prod.</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Install</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Bill</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Pay</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs font-medium">{o.order_no}</td>
                <td className="px-4 py-2.5 text-xs">{o.client_name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                  {viewMode === "amount" ? formatCurrency(o.total_amount) : o.total_qty}
                </td>
                <TatCell days={o.production_days} />
                <TatCell days={o.installation_days} />
                <TatCell days={o.billing_days} />
                <TatCell days={o.payment_days} />
                <TatCell days={o.total_days} bold />
                <td className="px-4 py-2.5 text-right">
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                    <Link to="/admin/orders/$id" params={{ id: String(o.id) }}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TatCell({ days, bold }: { days: number | null; bold?: boolean }) {
  if (days === null) return <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">—</td>;
  const level = agingLevel(days);
  return (
    <td
      className={cn(
        "px-4 py-2.5 text-right tabular-nums text-xs",
        bold && "font-semibold",
        level === "severe" && "text-red-600 dark:text-red-400",
        level === "warning" && "text-amber-600 dark:text-amber-400",
      )}
    >
      {days}d
    </td>
  );
}

function avg(nums: (number | null)[]): number | null {
  const valid = nums.filter((n): n is number => n !== null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}
