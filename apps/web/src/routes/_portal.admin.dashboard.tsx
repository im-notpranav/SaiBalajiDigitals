import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarIcon,
  CheckCircle2,
  Clock,
  Factory,
  Hash,
  IndianRupee,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchAdminDashboard, fetchCsmDashboard, fetchOverdueReport } from "@/api/dashboard";
import { fetchUsers } from "@/api/users";
import { inr } from "@/lib/format";
import { useAuth } from "@/lib/auth-store";
import { PaymentOverviewCard } from "@/components/payments/PaymentDashboard";
import { AllocationOverviewCard } from "@/components/allocation/AllocationOverview";
import { OperationsOverview } from "@/components/allocation/OperationsOverview";
import {
  AgingLegend,
  AttentionList,
  DashboardGuide,
  DateRangeControl,
  STAGE_AGING,
  SectionHeading,
  formatCurrency,
  scrollToSection,
  useDateRange,
  type AttentionItem,
} from "@/components/dashboard/DashboardBits";
import {
  OrderRowsTable,
  PipelineStages,
  type OrderRoutes,
  type StageKey,
  type ViewMode,
} from "@/components/dashboard/PipelineStages";

export const Route = createFileRoute("/_portal/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — SB OMS" }] }),
  component: AdminDashboard,
});

const OVERDUE_SECTION = "client-payment-overdue";

/** Rupee axis ticks that stay readable from a few hundred up to lakhs. */
function rupeeTick(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `₹${v}`;
}

const dayLabel = (iso: string) => format(new Date(`${iso}T00:00:00`), "dd MMM");

function AdminDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isOperations = user?.role === "OPERATION_MANAGER";
  const { range, setRange, from, to, widen } = useDateRange();
  const [viewMode, setViewMode] = useState<ViewMode>("amount");
  const [expanded, setExpanded] = useState<StageKey | null>(null);

  const { data: dash, isLoading, error, refetch } = useQuery({
    queryKey: ["csm-dashboard", "admin", from, to],
    queryFn: () => fetchCsmDashboard(from, to),
  });
  const { data: adminDash } = useQuery({
    queryKey: ["adminDashboard"],
    queryFn: fetchAdminDashboard,
  });
  // The Users page is the Admin's, so only the Admin gets a number that leads to it.
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: isAdmin,
  });

  const routes: OrderRoutes = { order: "/admin/orders/$id", list: "/admin/orders", from, to };
  const stageOrders = dash?.stage_orders;

  const overduePayments = useMemo(
    () =>
      (stageOrders?.payment ?? [])
        .filter((o) => o.days_in_stage > STAGE_AGING.severe)
        .sort((a, b) => b.days_in_stage - a.days_in_stage),
    [stageOrders?.payment],
  );

  // Every open order, whatever the dates above, so an old order stuck for weeks can't hide
  // behind the date filter. Same report, and the same cache, as the Overdue Orders page.
  const { data: overdueReport } = useQuery({
    queryKey: ["overdue-report", STAGE_AGING.severe],
    queryFn: () => fetchOverdueReport(STAGE_AGING.severe),
  });
  const stuck = overdueReport?.count ?? 0;

  const activeUsers =
    usersData?.users?.filter((u: { last_login_at?: string | null }) => {
      if (!u.last_login_at) return false;
      return Date.now() - new Date(u.last_login_at).getTime() < 30 * 24 * 60 * 60 * 1000;
    }).length ?? 0;

  const openStage = (key: StageKey) => {
    setExpanded(key);
    scrollToSection(`stage-${key}-orders`);
  };

  const attention: AttentionItem[] = [];
  if (stuck > 0) {
    attention.push({
      key: "stuck",
      tone: "warning",
      title: `${stuck} ${stuck === 1 ? "order has" : "orders have"} waited over ${STAGE_AGING.severe} working days in one stage`,
      detail: "Counted across every open order, whatever the dates above.",
      cta: "See overdue orders",
      to: "/admin/overdue",
      search: { days: STAGE_AGING.severe },
    });
  }
  if (overduePayments.length > 0) {
    attention.push({
      key: "client-payment",
      tone: "danger",
      title: `${overduePayments.length} client ${overduePayments.length === 1 ? "payment is" : "payments are"} late`,
      detail: `Invoiced more than ${STAGE_AGING.severe} working days ago and not paid yet.`,
      cta: "See which",
      onClick: () => scrollToSection(OVERDUE_SECTION),
    });
  }

  const trend = adminDash?.revenueTrend ?? [];
  const trendTotal = trend.reduce((sum, p) => sum + p.revenue, 0);
  const board = adminDash?.performanceLeaderboard ?? [];

  return (
    <>
      <PageHeader
        title={isOperations ? "Operations Dashboard" : "Administrator Dashboard"}
        description={
          isOperations
            ? "Field work first, then where every order stands."
            : "What needs you today, where every order stands, and how the business is doing."
        }
        crumbs={[{ label: "Dashboard" }]}
      />

      <DashboardGuide>
        {isOperations && (
          <p>
            <strong>Field work overview:</strong> pick dates to see who is free and how many jobs run where. Click a
            location tile to list its jobs. Orders and billing are view-only for you.
          </p>
        )}
        <p>
          <strong>Numbers at the top:</strong> each card says what it counts and what clicking does. They cover orders
          dated in the range you choose under “Orders dated”.
        </p>
        <p>
          <strong>Where orders are:</strong> every order sits in one of six stages. “Not assigned” means nobody has been given
          any of its production work yet; Accounts can bill those straight away. Click a stage to see its orders,
          with the longest wait first, then click an order number to open it.
        </p>
        <p>
          <strong>Amount / Quantity:</strong> switches the figures between rupees and pieces. It changes no data.
        </p>
        <AgingLegend />
      </DashboardGuide>

      {isOperations && <OperationsOverview />}

      <div className="flex flex-wrap items-center gap-3">
        <DateRangeControl range={range} onChange={setRange} />
        <div className="hidden h-6 w-px bg-border sm:block" />
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList className="h-9" aria-label="Show figures as">
            <TabsTrigger value="amount" className="gap-1 px-3 text-xs">
              <IndianRupee className="h-3 w-3" aria-hidden /> Amount
            </TabsTrigger>
            <TabsTrigger value="qty" className="gap-1 px-3 text-xs">
              <Hash className="h-3 w-3" aria-hidden /> Quantity
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <LoadingState className="mt-6" label="Loading dashboard…" />
      ) : !dash ? (
        <ErrorState className="mt-6" title="Couldn't load the dashboard" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <AttentionList items={attention} className="mt-6" />

          <div className={`mt-6 grid grid-cols-2 gap-3 sm:gap-4 ${isAdmin ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            <KpiCard
              label="Total Orders"
              value={dash.summary.total_orders}
              icon={Factory}
              accent="primary"
              hint="Dated in the range above"
              cta="See by stage"
              onClick={() => scrollToSection("pipeline")}
            />
            <KpiCard
              label={viewMode === "amount" ? "Total Amount" : "Total Quantity"}
              value={viewMode === "amount" ? formatCurrency(dash.summary.total_amount) : dash.summary.total_qty}
              icon={viewMode === "amount" ? IndianRupee : Hash}
              accent="success"
              hint={viewMode === "amount" ? "Order value of those orders" : "Pieces across those orders"}
              cta="Open reports"
              to="/admin/reports"
            />
            <KpiCard
              label="Open Orders"
              value={dash.summary.total_orders - (dash.stages.completed?.count ?? 0)}
              icon={Clock}
              accent="warning"
              hint="Not yet paid or closed"
              cta="Open the list"
              to="/admin/orders"
              search={{ section: "active", from, to }}
            />
            {isAdmin && (
              <KpiCard
                label="Active Users"
                value={activeUsers}
                icon={Users}
                accent="info"
                hint="Signed in during the last 30 days"
                cta="Manage users"
                to="/admin/users"
              />
            )}
            <KpiCard
              label="Avg cycle time"
              value={
                adminDash?.avg_cycle_days == null
                  ? "—"
                  : `${adminDash.avg_cycle_days} ${adminDash.avg_cycle_days === 1 ? "day" : "days"}`
              }
              icon={TrendingUp}
              accent="orange"
              hint="Working days, creation to closure"
              cta="See by stage"
              onClick={() => openStage("completed")}
            />
          </div>

          {!isOperations && (
            <div className="mt-6">
              <AllocationOverviewCard />
            </div>
          )}

          {/* The Admin only; the Operation Manager has no part in payments. */}
          {isAdmin && (
            <div className="mt-6">
              <PaymentOverviewCard />
            </div>
          )}

          <div className="mt-8">
            {dash.summary.total_orders === 0 ? (
              <EmptyState
                icon={CalendarIcon}
                title="No orders dated in this range"
                description={`Showing ${format(range.from, "dd MMM yyyy")} to ${format(range.to, "dd MMM yyyy")}. Orders are counted by their order date.`}
                action={
                  <Button variant="outline" size="sm" onClick={widen}>
                    Widen to the last 12 months
                  </Button>
                }
              />
            ) : (
              <PipelineStages
                data={dash}
                viewMode={viewMode}
                routes={routes}
                expanded={expanded}
                onExpand={setExpanded}
              />
            )}
          </div>

          {overduePayments.length > 0 && (
            <section id={OVERDUE_SECTION} className="mt-8 scroll-mt-20" aria-labelledby="client-payment-heading">
              <div className="overflow-hidden rounded-xl border border-red-500/20">
                <div className="flex flex-wrap items-center gap-2 bg-red-500/10 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden />
                  <h2 id="client-payment-heading" className="text-sm font-semibold text-red-700 dark:text-red-400">
                    Late client payments
                  </h2>
                  <Badge variant="destructive" className="ml-auto text-xs">
                    {overduePayments.length} {overduePayments.length === 1 ? "order" : "orders"}
                  </Badge>
                </div>
                <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                  Money clients owe: invoiced more than {STAGE_AGING.severe} working days ago and not paid. These are
                  different from the payment requests staff raise, which are in the card above.
                </p>
                <OrderRowsTable
                  label="Late client payments"
                  orders={overduePayments}
                  viewMode={viewMode}
                  orderRoute={routes.order}
                  daysLabel="Waiting"
                />
              </div>
            </section>
          )}

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <section className="surface-panel p-6 lg:col-span-2" aria-labelledby="trend-heading">
              <SectionHeading
                id="trend-heading"
                title="Invoiced in the last 7 days"
                description={`Invoice value of orders by order date. Total ${inr(trendTotal)}.`}
                action={
                  <Link to="/admin/reports" className="flex items-center gap-1 py-1 text-xs font-medium text-primary hover:underline">
                    Open reports <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                }
              />
              {trendTotal === 0 ? (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nothing has been invoiced on orders dated in the last 7 days.
                </p>
              ) : (
                <>
                  <div className="h-56" aria-hidden>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={dayLabel} />
                        <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={rupeeTick} width={52} />
                        <Tooltip
                          cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
                          contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }}
                          formatter={(v: number) => [inr(v), "Invoiced"]}
                          labelFormatter={(d: string) => dayLabel(d)}
                        />
                        <Bar isAnimationActive={false} dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {/* The chart's numbers for anyone who can't see the chart. */}
                  <table className="sr-only">
                    <caption>Invoiced value by order date, last 7 days</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Invoiced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trend.map((p) => (
                        <tr key={p.date}>
                          <td>{dayLabel(p.date)}</td>
                          <td>{inr(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>

            <section className="surface-panel p-6" aria-labelledby="leaderboard-heading">
              <SectionHeading
                id="leaderboard-heading"
                title="Top performers"
                description="Most completed orders, all time. Click a name to see their orders."
              />
              {board.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> No order has been completed yet.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {board.map((l) => (
                    <li key={l.name}>
                      <Link
                        to="/admin/orders"
                        search={{ section: "completed", creator: l.name }}
                        aria-label={`See completed orders by ${l.name}`}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{l.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {l.ordersCompleted} {l.ordersCompleted === 1 ? "order" : "orders"} completed
                          </span>
                        </span>
                        <span className="whitespace-nowrap font-bold text-success">{inr(l.revenueGenerated)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
