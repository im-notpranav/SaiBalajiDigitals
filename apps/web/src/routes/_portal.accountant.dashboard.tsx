import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Receipt,
  IndianRupee,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wallet,
  CalendarDays,
} from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAccountantDashboard,
  type AcctBillingItem,
  type AcctPaymentItem,
  type AcctCompletedItem,
} from "@/api/dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/accountant/dashboard")({
  head: () => ({ meta: [{ title: "Accountant Dashboard — SB OMS" }] }),
  component: AccountantDashboard,
});

/* ── Helpers ──────────────────────────────────────────────────── */

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function agingLevel(days: number, thresholds = { warn: 4, severe: 7 }): "normal" | "warning" | "severe" {
  if (days > thresholds.severe) return "severe";
  if (days > thresholds.warn) return "warning";
  return "normal";
}

function AgingBadge({ days, thresholds }: { days: number; thresholds?: { warn: number; severe: number } }) {
  const level = agingLevel(days, thresholds);
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

/* ── Section configs ──────────────────────────────────────────── */

interface SectionConfig {
  key: string;
  label: string;
  icon: typeof Receipt;
  accent: string;
  borderAccent: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "billing",
    label: "Billing Queue",
    icon: Receipt,
    accent: "bg-blue-500/10 text-blue-500",
    borderAccent: "border-blue-500/20",
  },
  {
    key: "payment",
    label: "Awaiting Payment",
    icon: IndianRupee,
    accent: "bg-amber-500/10 text-amber-500",
    borderAccent: "border-amber-500/20",
  },
  {
    key: "overdue",
    label: "Payment Overdue (>30 days)",
    icon: AlertTriangle,
    accent: "bg-red-500/10 text-red-600 dark:text-red-400",
    borderAccent: "border-red-500/30",
  },
  {
    key: "completed",
    label: "Collected",
    icon: CheckCircle2,
    accent: "bg-emerald-500/10 text-emerald-600",
    borderAccent: "border-emerald-500/20",
  },
];

/* ── Main component ───────────────────────────────────────────── */

function AccountantDashboard() {
  const today = new Date();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(today),
    to: endOfMonth(today),
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: dash, isLoading } = useQuery({
    queryKey: [
      "accountant-dashboard",
      format(dateRange.from, "yyyy-MM-dd"),
      format(dateRange.to, "yyyy-MM-dd"),
    ],
    queryFn: () =>
      fetchAccountantDashboard(
        format(dateRange.from, "yyyy-MM-dd"),
        format(dateRange.to, "yyyy-MM-dd")
      ),
  });

  const toggle = (key: string) => setExpanded((prev) => (prev === key ? null : key));

  return (
    <>
      <PageHeader
        title="Accountant Dashboard"
        description="Billing pipeline, payment tracking, and overdue monitoring."
        crumbs={[{ label: "Accountant" }, { label: "Dashboard" }]}
        actions={
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 rounded-xl">
                  <CalendarDays className="h-4 w-4" />
                  {format(dateRange.from, "dd MMM")} — {format(dateRange.to, "dd MMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) setDateRange({ from: range.from, to: range.to });
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            <Button asChild className="rounded-xl">
              <Link to="/accountant/billing">
                <Receipt className="mr-2 h-4 w-4" /> Open Billing Queue
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading accountant data…</div>
      ) : !dash ? (
        <div className="p-12 text-center text-muted-foreground">No data available.</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Billing Queue"
              value={dash.summary.billing_queue_count}
              icon={Receipt}
              accent="primary"
              delay={0}
              hint={formatCurrency(dash.summary.billing_queue_amount)}
            />
            <KpiCard
              label="Awaiting Payment"
              value={dash.summary.payment_pending_count}
              icon={IndianRupee}
              accent="warning"
              delay={0.05}
              hint={formatCurrency(dash.summary.payment_pending_amount)}
            />
            <KpiCard
              label="Overdue (>30d)"
              value={dash.summary.overdue_count}
              icon={AlertTriangle}
              accent="warning"
              delay={0.1}
              hint={dash.summary.overdue_amount > 0 ? formatCurrency(dash.summary.overdue_amount) : "None"}
            />
            <KpiCard
              label="Collected"
              value={dash.summary.collected_count}
              icon={Wallet}
              accent="success"
              delay={0.15}
              hint={formatCurrency(dash.summary.collected_amount)}
            />
          </div>

          {/* Expandable sections */}
          <div className="mt-8 space-y-4">
            {SECTIONS.map((section, idx) => {
              const isOpen = expanded === section.key;
              const count =
                section.key === "billing"
                  ? dash.billing_queue.length
                  : section.key === "payment"
                    ? dash.payment_queue.filter((p) => !p.is_overdue).length
                    : section.key === "overdue"
                      ? dash.payment_queue.filter((p) => p.is_overdue).length
                      : dash.completed.length;

              if (count === 0) return null;

              const Icon = section.icon;

              return (
                <motion.div
                  key={section.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + idx * 0.05 }}
                  className="rounded-xl border overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(section.key)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors",
                      section.borderAccent,
                      isOpen ? "border-b" : "",
                    )}
                  >
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", section.accent)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="flex-1 text-sm font-semibold">{section.label}</span>
                    <Badge variant="secondary" className="text-xs tabular-nums">
                      {count}
                    </Badge>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        {section.key === "billing" && (
                          <BillingTable items={dash.billing_queue} />
                        )}
                        {section.key === "payment" && (
                          <PaymentTable
                            items={dash.payment_queue.filter((p) => !p.is_overdue)}
                          />
                        )}
                        {section.key === "overdue" && (
                          <PaymentTable
                            items={dash.payment_queue.filter((p) => p.is_overdue)}
                            isOverdue
                          />
                        )}
                        {section.key === "completed" && (
                          <CompletedTable items={dash.completed} />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* Empty state */}
          {dash.billing_queue.length === 0 &&
            dash.payment_queue.length === 0 &&
            dash.completed.length === 0 && (
              <div className="mt-8 surface-panel p-12 text-center text-muted-foreground">
                No billing activity in the selected period.
              </div>
            )}
        </>
      )}
    </>
  );
}

/* ── Billing Queue table ──────────────────────────────────────── */

function BillingTable({ items }: { items: AcctBillingItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Store</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Amount</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Waiting</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5">
                <span className="font-mono text-xs font-medium">{item.order_no}</span>
              </td>
              <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.store_name}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                {formatCurrency(item.total_amount)}
              </td>
              <td className="px-4 py-2.5 text-right">
                <AgingBadge days={item.days_waiting} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                  <Link to="/accountant/billing/$id" params={{ id: String(item.id) }}>
                    <Receipt className="mr-1 h-3 w-3" /> Invoice
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Payment Queue table ──────────────────────────────────────── */

function PaymentTable({ items, isOverdue = false }: { items: AcctPaymentItem[]; isOverdue?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={cn("border-b", isOverdue ? "bg-red-500/5" : "bg-muted/30")}>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Invoice</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Billed</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">CSM</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Age</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={cn(
                "border-b last:border-0 transition-colors",
                isOverdue ? "hover:bg-red-500/5" : "hover:bg-muted/20"
              )}
            >
              <td className="px-4 py-2.5">
                <span className="font-mono text-xs font-medium">{item.order_no}</span>
              </td>
              <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {item.invoice_no || "—"}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                {formatCurrency(item.bill_amount)}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.creator_name}</td>
              <td className="px-4 py-2.5 text-right">
                <AgingBadge
                  days={item.days_since_billed}
                  thresholds={isOverdue ? { warn: 30, severe: 45 } : { warn: 15, severe: 30 }}
                />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                  <Link to="/accountant/billing/$id" params={{ id: String(item.id) }}>
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Completed table ──────────────────────────────────────────── */

function CompletedTable({ items }: { items: AcctCompletedItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Order</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Client</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Invoice</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Billed</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Received</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Payment TAT</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Paid On</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5">
                <Link
                  to="/accountant/billing/$id"
                  params={{ id: String(item.id) }}
                  className="font-mono text-xs font-medium text-primary hover:underline"
                >
                  {item.order_no}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-xs">{item.client_name}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {item.invoice_no || "—"}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                {formatCurrency(item.bill_amount)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                <span
                  className={cn(
                    item.amount_received < item.bill_amount
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {formatCurrency(item.amount_received)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                {item.payment_tat != null ? (
                  <AgingBadge days={item.payment_tat} thresholds={{ warn: 15, severe: 30 }} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                {format(new Date(item.paid_at), "dd MMM yyyy")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
