import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  IndianRupee,
  Receipt,
  Store,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchAccountantDashboard,
  type AcctBillingItem,
  type AcctCompletedItem,
  type AcctPaymentItem,
} from "@/api/dashboard";
import { cn } from "@/lib/utils";
import {
  AgingBadge,
  AgingLegend,
  AttentionList,
  DashboardGuide,
  DateRangeControl,
  ScrollTable,
  formatCurrency,
  scrollToSection,
  useDateRange,
  type AgingThresholds,
} from "@/components/dashboard/DashboardBits";

export const Route = createFileRoute("/_portal/accountant/dashboard")({
  head: () => ({ meta: [{ title: "Accountant Dashboard — SB OMS" }] }),
  component: AccountantDashboard,
});

const BILLING_AGING: AgingThresholds = { warn: 4, severe: 7 };
const PAYMENT_AGING: AgingThresholds = { warn: 15, severe: 30 };
const OVERDUE_AGING: AgingThresholds = { warn: 30, severe: 45 };

type SectionKey = "billing" | "payment" | "overdue" | "completed";

const SECTIONS: {
  key: SectionKey;
  label: string;
  means: string;
  empty: string;
  icon: typeof Receipt;
  accent: string;
  border: string;
}[] = [
  {
    key: "billing",
    label: "Billing Queue",
    means: "Ready for you to raise an invoice: installed, or with no production work assigned",
    empty: "Nothing is waiting for an invoice on these dates.",
    icon: Receipt,
    accent: "bg-blue-500/10 text-blue-500",
    border: "border-blue-500/20",
  },
  {
    key: "payment",
    label: "Awaiting Payment",
    means: "Invoiced, and the client still has time to pay",
    empty: "No invoices are waiting for payment on these dates.",
    icon: IndianRupee,
    accent: "bg-amber-500/10 text-amber-500",
    border: "border-amber-500/20",
  },
  {
    key: "overdue",
    label: "Payment Overdue",
    means: "Invoiced over 30 working days ago and still not paid",
    empty: "No payment is overdue on these dates.",
    icon: AlertTriangle,
    accent: "bg-red-500/10 text-red-600 dark:text-red-400",
    border: "border-red-500/30",
  },
  {
    key: "completed",
    label: "Collected",
    means: "Paid in full or closed",
    empty: "Nothing has been collected on these dates.",
    icon: CheckCircle2,
    accent: "bg-emerald-500/10 text-emerald-600",
    border: "border-emerald-500/20",
  },
];

const sectionId = (key: SectionKey) => `accounts-${key}`;

function AccountantDashboard() {
  const { range, setRange, from, to } = useDateRange();
  // undefined until someone chooses: the first section with anything in it starts open.
  const [chosen, setChosen] = useState<SectionKey | null | undefined>(undefined);

  const { data: dash, isLoading, error, refetch } = useQuery({
    queryKey: ["accountant-dashboard", from, to],
    queryFn: () => fetchAccountantDashboard(from, to),
  });

  const lists = {
    billing: dash?.billing_queue ?? [],
    payment: (dash?.payment_queue ?? []).filter((p) => !p.is_overdue),
    overdue: (dash?.payment_queue ?? []).filter((p) => p.is_overdue),
    completed: dash?.completed ?? [],
  };
  const countOf = (key: SectionKey) => lists[key].length;
  const firstWithItems = SECTIONS.find((s) => countOf(s.key) > 0)?.key ?? null;
  const expanded = chosen === undefined ? firstWithItems : chosen;

  const openSection = (key: SectionKey) => {
    setChosen(key);
    scrollToSection(sectionId(key));
  };

  return (
    <>
      <PageHeader
        title="Accountant Dashboard"
        description="What to invoice, what clients still owe, and what has come in."
        crumbs={[{ label: "Dashboard" }]}
        actions={
          <Button asChild className="rounded-xl">
            <Link to="/accountant/billing">
              <Receipt className="mr-2 h-4 w-4" aria-hidden /> Open Billing Queue
            </Link>
          </Button>
        }
      />

      <DashboardGuide>
        <p>
          <strong>The four cards:</strong> an order moves from Billing Queue to Awaiting Payment to Collected. If the
          client takes more than 30 working days it shows under Overdue. Click a card to see its orders below.
        </p>
        <p>
          <strong>Dates:</strong> “Orders dated” decides which orders are counted, by their order date. An older order
          still waiting is outside the count until you widen the dates.
        </p>
        <p>
          <strong>In each list:</strong> click an order number or “Invoice” to raise an invoice, or “Record payment” to
          enter money received. “Needs stores” means the CSM hasn’t added the order’s stores and items yet, so there
          is nothing to invoice until they do.
        </p>
        <AgingLegend thresholds={PAYMENT_AGING} />
      </DashboardGuide>

      <DateRangeControl range={range} onChange={setRange} className="mb-6" />

      {isLoading ? (
        <LoadingState label="Loading dashboard…" />
      ) : !dash ? (
        <ErrorState title="Couldn't load the dashboard" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <AttentionList
            className="mb-6"
            items={
              dash.summary.overdue_count > 0
                ? [
                    {
                      key: "overdue",
                      tone: "danger",
                      title: `${dash.summary.overdue_count} ${dash.summary.overdue_count === 1 ? "invoice is" : "invoices are"} overdue, ${formatCurrency(dash.summary.overdue_amount)} in all`,
                      detail: "Invoiced over 30 working days ago and still not paid.",
                      cta: "See which",
                      onClick: () => openSection("overdue"),
                    },
                  ]
                : []
            }
          />

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiCard
              label="Billing Queue"
              value={dash.summary.billing_queue_count}
              icon={Receipt}
              accent="primary"
              hint={`${formatCurrency(dash.summary.billing_queue_amount)} to invoice`}
              cta="See orders"
              onClick={() => openSection("billing")}
            />
            <KpiCard
              label="Awaiting Payment"
              value={dash.summary.payment_pending_count}
              icon={IndianRupee}
              accent="warning"
              hint={`${formatCurrency(dash.summary.payment_pending_amount)} invoiced, overdue included`}
              cta="See orders"
              onClick={() => openSection("payment")}
            />
            <KpiCard
              label="Overdue"
              value={dash.summary.overdue_count}
              icon={AlertTriangle}
              accent="warning"
              hint={
                dash.summary.overdue_amount > 0
                  ? `${formatCurrency(dash.summary.overdue_amount)} over 30 working days`
                  : "Nothing over 30 working days"
              }
              cta="See orders"
              onClick={() => openSection("overdue")}
            />
            <KpiCard
              label="Collected"
              value={dash.summary.collected_count}
              icon={Wallet}
              accent="success"
              hint={`${formatCurrency(dash.summary.collected_amount)} received`}
              cta="See orders"
              onClick={() => openSection("completed")}
            />
          </div>

          <div className="mt-8 space-y-4">
            {SECTIONS.map((section) => {
              const open = expanded === section.key;
              const count = countOf(section.key);
              const Icon = section.icon;
              const panel = `${sectionId(section.key)}-panel`;
              return (
                <div
                  key={section.key}
                  id={sectionId(section.key)}
                  className={cn("scroll-mt-20 overflow-hidden rounded-xl border", open && section.border)}
                >
                  <h2>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panel}
                      onClick={() => setChosen(open ? null : section.key)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        open && "border-b",
                      )}
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", section.accent)}>
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{section.label}</span>
                        <span className="block text-xs font-normal text-muted-foreground">{section.means}</span>
                      </span>
                      <Badge variant="secondary" className="text-xs tabular-nums">
                        {count}
                      </Badge>
                      {open ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                    </button>
                  </h2>
                  {open && (
                    <div id={panel}>
                      {count === 0 ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">{section.empty}</p>
                      ) : section.key === "billing" ? (
                        <BillingTable items={lists.billing} />
                      ) : section.key === "payment" ? (
                        <PaymentTable label={section.label} items={lists.payment} />
                      ) : section.key === "overdue" ? (
                        <PaymentTable label={section.label} items={lists.overdue} isOverdue />
                      ) : (
                        <CompletedTable items={lists.completed} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function OrderCell({ id, orderNo }: { id: number; orderNo: string }) {
  return (
    <td className="whitespace-nowrap px-4 py-2.5">
      <Link
        to="/accountant/billing/$id"
        params={{ id: String(id) }}
        className="-my-1 inline-block py-1.5 font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {orderNo}
      </Link>
    </td>
  );
}

/** In place of "Invoice" for an order with no stores: there is nothing to bill until the CSM adds them. */
function NeedsStoresCell() {
  return (
    <td className="whitespace-nowrap px-4 py-2.5 text-right">
      <span
        title="The CSM has to add this order's stores and items before it can be invoiced."
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
      >
        <Store className="h-3 w-3" aria-hidden /> Needs stores
      </span>
    </td>
  );
}

function ActionCell({ id, label, orderNo, icon: Icon }: { id: number; label: string; orderNo: string; icon: typeof Receipt }) {
  return (
    <td className="whitespace-nowrap px-4 py-2.5 text-right">
      <Link
        to="/accountant/billing/$id"
        params={{ id: String(id) }}
        aria-label={`${label}, order ${orderNo}`}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </Link>
    </td>
  );
}

const TH = "px-4 py-2.5 font-medium text-muted-foreground";

function BillingTable({ items }: { items: AcctBillingItem[] }) {
  return (
    <ScrollTable label="Billing queue">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th scope="col" className={cn(TH, "text-left")}>Order</th>
            <th scope="col" className={cn(TH, "text-left")}>Client</th>
            <th scope="col" className={cn(TH, "text-left")}>Store</th>
            <th scope="col" className={cn(TH, "text-right")}>Amount</th>
            <th scope="col" className={cn(TH, "text-right")}>Waiting</th>
            <th scope="col" className={TH}><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b transition-colors last:border-0 hover:bg-muted/20">
              <OrderCell id={item.id} orderNo={item.order_no} />
              <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.store_name}</td>
              <td className="px-4 py-2.5 text-right text-xs font-medium tabular-nums">
                {formatCurrency(item.total_amount)}
              </td>
              <td className="px-4 py-2.5 text-right">
                <AgingBadge days={item.days_waiting} thresholds={BILLING_AGING} />
              </td>
              {item.store_count === 0 ? (
                <NeedsStoresCell />
              ) : (
                <ActionCell id={item.id} orderNo={item.order_no} label="Invoice" icon={Receipt} />
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <AgingLegend thresholds={BILLING_AGING} className="border-t px-4 py-2" />
    </ScrollTable>
  );
}

function PaymentTable({
  label,
  items,
  isOverdue = false,
}: {
  label: string;
  items: AcctPaymentItem[];
  isOverdue?: boolean;
}) {
  const thresholds = isOverdue ? OVERDUE_AGING : PAYMENT_AGING;
  return (
    <ScrollTable label={label}>
      <table className="w-full text-sm">
        <thead>
          <tr className={cn("border-b", isOverdue ? "bg-red-500/5" : "bg-muted/30")}>
            <th scope="col" className={cn(TH, "text-left")}>Order</th>
            <th scope="col" className={cn(TH, "text-left")}>Client</th>
            <th scope="col" className={cn(TH, "text-left")}>Invoice</th>
            <th scope="col" className={cn(TH, "text-right")}>Billed</th>
            <th scope="col" className={cn(TH, "text-left")}>CSM</th>
            <th scope="col" className={cn(TH, "text-right")}>Since invoice</th>
            <th scope="col" className={TH}><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={cn(
                "border-b transition-colors last:border-0",
                isOverdue ? "hover:bg-red-500/5" : "hover:bg-muted/20",
              )}
            >
              <OrderCell id={item.id} orderNo={item.order_no} />
              <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.invoice_no || "—"}</td>
              <td className="px-4 py-2.5 text-right text-xs font-medium tabular-nums">
                {formatCurrency(item.bill_amount)}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.creator_name}</td>
              <td className="px-4 py-2.5 text-right">
                <AgingBadge days={item.days_since_billed} thresholds={thresholds} />
              </td>
              <ActionCell id={item.id} orderNo={item.order_no} label="Record payment" icon={IndianRupee} />
            </tr>
          ))}
        </tbody>
      </table>
      <AgingLegend thresholds={thresholds} className="border-t px-4 py-2" />
    </ScrollTable>
  );
}

function CompletedTable({ items }: { items: AcctCompletedItem[] }) {
  return (
    <ScrollTable label="Collected">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th scope="col" className={cn(TH, "text-left")}>Order</th>
            <th scope="col" className={cn(TH, "text-left")}>Client</th>
            <th scope="col" className={cn(TH, "text-left")}>Invoice</th>
            <th scope="col" className={cn(TH, "text-right")}>Billed</th>
            <th scope="col" className={cn(TH, "text-right")}>Received</th>
            <th scope="col" className={cn(TH, "text-right")}>Days to pay</th>
            <th scope="col" className={cn(TH, "text-right")}>Paid on</th>
            <th scope="col" className={TH}><span className="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b transition-colors last:border-0 hover:bg-muted/20">
              <OrderCell id={item.id} orderNo={item.order_no} />
              <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.invoice_no || "—"}</td>
              <td className="px-4 py-2.5 text-right text-xs font-medium tabular-nums">
                {formatCurrency(item.bill_amount)}
              </td>
              <td className="px-4 py-2.5 text-right text-xs font-medium tabular-nums">
                <span
                  className={
                    item.amount_received < item.bill_amount
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }
                >
                  {formatCurrency(item.amount_received)}
                </span>
                {item.amount_received < item.bill_amount && <span className="sr-only"> less than billed</span>}
              </td>
              <td className="px-4 py-2.5 text-right">
                {item.payment_tat != null ? (
                  <AgingBadge days={item.payment_tat} thresholds={PAYMENT_AGING} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-muted-foreground">
                {format(new Date(item.paid_at), "dd MMM yyyy")}
              </td>
              <ActionCell id={item.id} orderNo={item.order_no} label="Open" icon={ArrowRight} />
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
