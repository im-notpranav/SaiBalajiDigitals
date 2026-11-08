import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarIcon, Clock, Factory, Hash, IndianRupee, PlusCircle, Truck, Upload, Wallet } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchCsmDashboard } from "@/api/dashboard";
import { addDays, fetchCsmJobs, todayIST } from "@/api/allocation";
import { OPEN_PAYMENT_STATUSES, fetchPaymentRequests } from "@/api/payments";
import {
  AgingLegend,
  AttentionList,
  DashboardGuide,
  DateRangeControl,
  formatCurrency,
  scrollToSection,
  useDateRange,
  type AttentionItem,
} from "@/components/dashboard/DashboardBits";
import {
  PipelineStages,
  type OrderRoutes,
  type StageKey,
  type ViewMode,
} from "@/components/dashboard/PipelineStages";

export const Route = createFileRoute("/_portal/employee/dashboard")({
  head: () => ({ meta: [{ title: "My Dashboard — SB OMS" }] }),
  component: EmployeeDashboard,
});

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function EmployeeDashboard() {
  const { range, setRange, from, to, widen } = useDateRange();
  const [viewMode, setViewMode] = useState<ViewMode>("amount");
  const [expanded, setExpanded] = useState<StageKey | null>(null);

  const { data: dash, isLoading, error, refetch } = useQuery({
    queryKey: ["csm-dashboard", from, to],
    queryFn: () => fetchCsmDashboard(from, to),
  });
  const { data: jobsData } = useQuery({ queryKey: ["csm-jobs"], queryFn: fetchCsmJobs });
  const { data: requestsData } = useQuery({
    queryKey: ["payment-requests", "mine"],
    queryFn: () => fetchPaymentRequests(),
  });

  const routes: OrderRoutes = { order: "/employee/orders/$id", list: "/employee/orders", from, to };

  const today = todayIST();
  const weekEnd = addDays(today, 6);
  const liveJobs = (jobsData?.jobs ?? []).filter((j) => j.status !== "CANCELLED" && j.status !== "COMPLETED");
  const jobsThisWeek = liveJobs.filter((j) => j.start_date <= weekEnd && j.end_date >= today).length;
  const jobsNeedingDetails = liveJobs.filter((j) => !j.work_details).length;

  const requests = requestsData?.requests ?? [];
  const openRequests = requests.filter((r) => OPEN_PAYMENT_STATUSES.includes(r.status)).length;
  const returnedRequests = requests.filter((r) => r.status === "INFO_REQUESTED").length;

  // An order an admin started has a number and a client, and waits for this person's stores.
  const needStores = [...(dash?.stage_orders.unassigned ?? []), ...(dash?.stage_orders.production ?? [])].filter(
    (o) => o.store_count === 0,
  ).length;

  const attention: AttentionItem[] = [];
  if (returnedRequests > 0) {
    attention.push({
      key: "returned",
      tone: "danger",
      title: `${returnedRequests} payment ${plural(returnedRequests, "request was", "requests were")} returned to you`,
      detail: "Cost Control or the Admin needs more information before paying.",
      cta: "Fix and resubmit",
      to: "/employee/payments",
    });
  }
  if (needStores > 0) {
    attention.push({
      key: "stores",
      tone: "warning",
      title: `${needStores} ${plural(needStores, "order needs", "orders need")} stores added`,
      detail: "The Admin started these orders for you. Production can't begin until they have stores and items.",
      cta: "Add stores",
      to: "/employee/orders",
      search: { section: "active" },
    });
  }
  if (jobsNeedingDetails > 0) {
    attention.push({
      key: "job-details",
      tone: "info",
      title: `${jobsNeedingDetails} field ${plural(jobsNeedingDetails, "job needs", "jobs need")} work details`,
      detail: "The field team sees these details on their phones.",
      cta: "Add details",
      to: "/employee/jobs",
    });
  }

  return (
    <>
      <PageHeader
        title="My Dashboard"
        description="What needs you, and where each of your orders stands."
        crumbs={[{ label: "Dashboard" }]}
        actions={
          <>
            <Button asChild variant="outline" size="lg" className="rounded-xl">
              <Link to="/employee/upload-orders">
                <Upload className="mr-2 h-4 w-4" aria-hidden /> Upload orders
              </Link>
            </Button>
            <Button asChild size="lg" className="rounded-xl shadow-soft">
              <Link to="/employee/new-order">
                <PlusCircle className="mr-2 h-4 w-4" aria-hidden /> New order
              </Link>
            </Button>
          </>
        }
      />

      <DashboardGuide>
        <p>
          <strong>Coloured rows at the top</strong> are things waiting on you. Each one goes straight to where you deal
          with it. No rows means nothing is waiting.
        </p>
        <p>
          <strong>Where orders are:</strong> your orders move left to right through six stages, starting at “Not assigned”
          until production work is given out. Click a stage to see
          its orders, then click an order number to open it.
        </p>
        <p>
          <strong>Dates:</strong> “Orders dated” decides which orders are counted, by their order date. You only see
          orders you created.
        </p>
        <AgingLegend />
      </DashboardGuide>

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

      <AttentionList items={attention} className="mt-6" />

      {isLoading ? (
        <LoadingState className="mt-6" label="Loading dashboard…" />
      ) : !dash ? (
        <ErrorState className="mt-6" title="Couldn't load your dashboard" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <KpiCard
              label="Total Orders"
              value={dash.summary.total_orders}
              icon={Factory}
              accent="primary"
              hint="Yours, dated in the range above"
              cta="See by stage"
              onClick={() => scrollToSection("pipeline")}
            />
            <KpiCard
              label={viewMode === "amount" ? "Total Amount" : "Total Quantity"}
              value={viewMode === "amount" ? formatCurrency(dash.summary.total_amount) : dash.summary.total_qty}
              icon={viewMode === "amount" ? IndianRupee : Hash}
              accent="success"
              hint={viewMode === "amount" ? "Order value of those orders" : "Pieces across those orders"}
              cta="See by stage"
              onClick={() => scrollToSection("pipeline")}
            />
            <KpiCard
              label="Open Orders"
              value={dash.summary.total_orders - (dash.stages.completed?.count ?? 0)}
              icon={Clock}
              accent="warning"
              hint="Not yet paid or closed"
              cta="Open the list"
              to="/employee/orders"
              search={{ section: "active", from, to }}
            />
            <KpiCard
              label="Field Jobs"
              value={jobsData ? jobsThisWeek : "—"}
              icon={Truck}
              accent="info"
              hint="Running in the next 7 days"
              cta="Open field jobs"
              to="/employee/jobs"
            />
            <KpiCard
              label="Payment Requests"
              value={requestsData ? openRequests : "—"}
              icon={Wallet}
              accent="orange"
              hint="Yours, still open"
              cta="Open requests"
              to="/employee/payments"
            />
          </div>

          <div className="mt-8">
            {dash.summary.total_orders === 0 ? (
              <EmptyState
                icon={CalendarIcon}
                title="No orders dated in this range"
                description={`Showing ${format(range.from, "dd MMM yyyy")} to ${format(range.to, "dd MMM yyyy")}. Orders are counted by their order date, and you only see orders you created.`}
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
        </>
      )}
    </>
  );
}
