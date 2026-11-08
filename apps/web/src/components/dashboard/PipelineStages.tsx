import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Factory,
  PackageCheck,
  Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CsmCompletedOrder, CsmDashboardData, CsmStageOrder } from "@/api/dashboard";
import {
  AgingBadge,
  AgingLegend,
  ScrollTable,
  SectionHeading,
  agingLevel,
  formatCurrency,
  scrollToSection,
} from "./DashboardBits";

/**
 * The five stages every order passes through, shared by the Admin's and the CSM's dashboards.
 * A stage opens its orders underneath, and each order links to its own page.
 */

export type StageKey = "production" | "installation" | "billing" | "payment" | "completed";
export type ViewMode = "amount" | "qty";

/** Where this person opens an order, and where their full order list lives. */
export interface OrderRoutes {
  order: "/admin/orders/$id" | "/employee/orders/$id";
  list: "/admin/orders" | "/employee/orders";
  /** The date range in force, so the full list shows the same orders as the stage. */
  from: string;
  to: string;
}

const STAGES: {
  key: StageKey;
  label: string;
  means: string;
  icon: typeof Factory;
  accent: string;
  bg: string;
  border: string;
}[] = [
  { key: "production", label: "Production", means: "Being made", icon: Factory, accent: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  { key: "installation", label: "Installation", means: "Made, waiting to be installed", icon: PackageCheck, accent: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  { key: "billing", label: "Billing", means: "Installed, waiting for an invoice", icon: Receipt, accent: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  { key: "payment", label: "Payment", means: "Invoiced, waiting for the client to pay", icon: CreditCard, accent: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  { key: "completed", label: "Completed", means: "Paid or closed", icon: CheckCircle2, accent: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
];

const panelId = (key: StageKey) => `stage-${key}-orders`;

export function PipelineStages({
  data,
  viewMode,
  routes,
  expanded,
  onExpand,
}: {
  data: CsmDashboardData;
  viewMode: ViewMode;
  routes: OrderRoutes;
  expanded: StageKey | null;
  onExpand: (key: StageKey | null) => void;
}) {
  return (
    <section aria-labelledby="pipeline-heading" id="pipeline" className="scroll-mt-20">
      <SectionHeading
        id="pipeline-heading"
        title="Where orders are"
        description="Every order sits in one stage, left to right. Click a stage to see its orders."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {STAGES.map((stage) => {
          const summary = data.stages[stage.key];
          const open = expanded === stage.key;
          const Icon = stage.icon;
          return (
            <button
              key={stage.key}
              type="button"
              aria-expanded={open}
              aria-controls={open ? panelId(stage.key) : undefined}
              onClick={() => {
                onExpand(open ? null : stage.key);
                if (!open) scrollToSection(panelId(stage.key));
              }}
              className={cn(
                "group flex flex-col rounded-xl border p-4 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                open ? `${stage.border} ${stage.bg} shadow-md` : "bg-card hover:-translate-y-0.5",
              )}
            >
              <span className="flex items-center justify-between">
                <span className={cn("rounded-lg p-1.5", stage.bg)}>
                  <Icon className={cn("h-4 w-4", stage.accent)} aria-hidden />
                </span>
                {open ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
              </span>
              <span className="mt-3 text-2xl font-bold tabular-nums">{summary?.count ?? 0}</span>
              <span className="text-sm font-medium">{stage.label}</span>
              <span className="text-xs text-muted-foreground">{stage.means}</span>
              <span className="mt-1 text-xs font-medium tabular-nums">
                {viewMode === "amount" ? formatCurrency(summary?.amount ?? 0) : `${summary?.qty ?? 0} qty`}
              </span>
            </button>
          );
        })}
      </div>

      {expanded && (
        <div id={panelId(expanded)} className="mt-4 scroll-mt-20">
          {expanded === "completed" ? (
            <CompletedOrders orders={data.stage_orders.completed} viewMode={viewMode} routes={routes} />
          ) : (
            <StageOrders stage={expanded} orders={data.stage_orders[expanded]} viewMode={viewMode} routes={routes} />
          )}
        </div>
      )}
    </section>
  );
}

function FullListLink({ routes, completed }: { routes: OrderRoutes; completed?: boolean }) {
  return (
    <Link
      to={routes.list}
      search={{ section: completed ? "completed" : "active", from: routes.from, to: routes.to } as never}
      className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline"
    >
      Open full list <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

function StageOrders({
  stage,
  orders,
  viewMode,
  routes,
}: {
  stage: Exclude<StageKey, "completed">;
  orders: CsmStageOrder[];
  viewMode: ViewMode;
  routes: OrderRoutes;
}) {
  const config = STAGES.find((s) => s.key === stage)!;
  const sorted = useMemo(() => [...orders].sort((a, b) => b.days_in_stage - a.days_in_stage), [orders]);

  if (sorted.length === 0) {
    return (
      <div className={cn("rounded-xl border p-6 text-center text-sm text-muted-foreground", config.border, config.bg)}>
        No orders in {config.label.toLowerCase()} for these dates.
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border", config.border)}>
      <div className={cn("flex flex-wrap items-center gap-2 px-4 py-3", config.bg)}>
        <config.icon className={cn("h-4 w-4", config.accent)} aria-hidden />
        <h3 className="text-sm font-semibold">{config.label}</h3>
        <Badge variant="secondary" className="text-xs">
          {sorted.length} {sorted.length === 1 ? "order" : "orders"}
        </Badge>
        <span className="text-xs text-muted-foreground">Longest wait first</span>
        <span className="ml-auto">
          <FullListLink routes={routes} />
        </span>
      </div>
      <OrderRowsTable label={`${config.label} orders`} orders={sorted} viewMode={viewMode} orderRoute={routes.order} daysLabel="Days in this stage" />
      <AgingLegend className="border-t px-4 py-2" />
    </div>
  );
}

/** One row per order: its number, client, value, how long it has waited, and a way in. */
export function OrderRowsTable({
  label,
  orders,
  viewMode,
  orderRoute,
  daysLabel,
}: {
  label: string;
  orders: CsmStageOrder[];
  viewMode: ViewMode;
  orderRoute: OrderRoutes["order"];
  daysLabel: string;
}) {
  return (
    <ScrollTable label={label}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client / Store</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">
              {viewMode === "amount" ? "Amount" : "Qty"}
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">{daysLabel}</th>
            <th scope="col" className="px-4 py-2.5"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b transition-colors last:border-0 hover:bg-muted/20">
              <td className="whitespace-nowrap px-4 py-2.5">
                <OrderLink route={orderRoute} id={o.id} orderNo={o.order_no} />
              </td>
              <td className="px-4 py-2.5">
                <div className="text-xs font-medium">{o.client_name}</div>
                <div className="text-[11px] text-muted-foreground">{o.store_name}</div>
              </td>
              <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                {viewMode === "amount" ? formatCurrency(o.total_amount) : o.total_qty}
              </td>
              <td className="px-4 py-2.5 text-right">
                <AgingBadge days={o.days_in_stage} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <OpenLink route={orderRoute} id={o.id} orderNo={o.order_no} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function OrderLink({ route, id, orderNo }: { route: OrderRoutes["order"]; id: number; orderNo: string }) {
  return (
    <Link
      to={route}
      params={{ id: String(id) } as never}
      className="-my-1 inline-block py-1.5 font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {orderNo}
    </Link>
  );
}

function OpenLink({ route, id, orderNo }: { route: OrderRoutes["order"]; id: number; orderNo: string }) {
  return (
    <Link
      to={route}
      params={{ id: String(id) } as never}
      aria-label={`Open order ${orderNo}`}
      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

function CompletedOrders({
  orders,
  viewMode,
  routes,
}: {
  orders: CsmCompletedOrder[];
  viewMode: ViewMode;
  routes: OrderRoutes;
}) {
  const sorted = useMemo(() => [...orders].sort((a, b) => b.total_days - a.total_days), [orders]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center text-sm text-muted-foreground">
        No completed orders for these dates.
      </div>
    );
  }

  const averages = [
    { label: "Production", val: avg(sorted.map((o) => o.production_days)) },
    { label: "Installation", val: avg(sorted.map((o) => o.installation_days)) },
    { label: "Billing", val: avg(sorted.map((o) => o.billing_days)) },
    { label: "Payment", val: avg(sorted.map((o) => o.payment_days)) },
    { label: "Total", val: avg(sorted.map((o) => o.total_days)) },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/20">
      <div className="flex flex-wrap items-center gap-2 bg-emerald-500/10 px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
        <h3 className="text-sm font-semibold">Completed: how long each stage took</h3>
        <Badge variant="secondary" className="text-xs">
          {sorted.length} {sorted.length === 1 ? "order" : "orders"}
        </Badge>
        <span className="ml-auto">
          <FullListLink routes={routes} completed />
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-px bg-border sm:grid-cols-5">
        {averages.map((item) => (
          <div key={item.label} className="bg-card px-3 py-2 text-center">
            <dt className="text-[11px] text-muted-foreground">Average {item.label.toLowerCase()}</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums">{item.val !== null ? `${item.val}d` : "—"}</dd>
          </div>
        ))}
      </dl>

      <ScrollTable label="Completed orders">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                {viewMode === "amount" ? "Amount" : "Qty"}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">Production</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">Installation</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">Billing</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">Payment</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.id} className="border-b transition-colors last:border-0 hover:bg-muted/20">
                <td className="whitespace-nowrap px-4 py-2.5">
                  <OrderLink route={routes.order} id={o.id} orderNo={o.order_no} />
                </td>
                <td className="px-4 py-2.5 text-xs">{o.client_name}</td>
                <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                  {viewMode === "amount" ? formatCurrency(o.total_amount) : o.total_qty}
                </td>
                <TatCell days={o.production_days} />
                <TatCell days={o.installation_days} />
                <TatCell days={o.billing_days} />
                <TatCell days={o.payment_days} />
                <TatCell days={o.total_days} bold />
                <td className="px-4 py-2.5 text-right">
                  <OpenLink route={routes.order} id={o.id} orderNo={o.order_no} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        Working days, Sundays not counted. A dash means the order skipped that stage.
      </p>
    </div>
  );
}

function TatCell({ days, bold }: { days: number | null; bold?: boolean }) {
  if (days === null) return <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">—</td>;
  const level = agingLevel(days);
  return (
    <td
      className={cn(
        "px-4 py-2.5 text-right text-xs tabular-nums",
        bold && "font-semibold",
        level === "severe" && "text-red-600 dark:text-red-400",
        level === "warning" && "text-amber-700 dark:text-amber-400",
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
