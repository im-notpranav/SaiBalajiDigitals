import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Banknote, Hourglass, Inbox, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  PAYMENT_STATUS_LABELS,
  WAITING_STATUSES,
  fetchPaymentDashboard,
  formatRupees,
  type OverdueItem,
  type PaymentDashboardData,
  type PaymentTimer,
  type TimerKind,
  type WaitingStatus,
} from "@/api/payments";
import { TIMER_KIND_LABELS, TimerChips, overdueText, workingDays } from "./PaymentTimers";

/**
 * The Admin's and Cost Control's overview of payment requests: what waits on them, what has
 * run past the overdue limit, where requests are waiting, and money paid out this month.
 */

const dashboardQuery = { queryKey: ["payment-requests", "dashboard"], queryFn: fetchPaymentDashboard };

const SHOWN = 6;

function Tile({
  label,
  value,
  hint,
  icon: Icon,
  alert,
  onClick,
}: {
  label: string;
  value: string | number;
  hint: React.ReactNode;
  icon: LucideIcon;
  alert?: boolean;
  onClick?: () => void;
}) {
  const Box = onClick ? "button" : "div";
  return (
    <Box
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "surface-panel p-4 text-left",
        onClick && "transition-colors hover:bg-muted/40",
        alert && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {label}
        <Icon className={cn("h-4 w-4", alert && "text-destructive")} />
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", alert && overdueText(true))}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </Box>
  );
}

const kindSummary = (byKind: Partial<Record<TimerKind, number>>) =>
  (Object.entries(byKind) as [TimerKind, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${TIMER_KIND_LABELS[k]}`)
    .join(" · ");

/** One row per request: a request overdue on two things (review and bill) shows both chips. */
type OverdueRequest = Omit<OverdueItem, "timer"> & { timers: PaymentTimer[] };

function byRequest(items: OverdueItem[]): OverdueRequest[] {
  const rows = new Map<number, OverdueRequest>();
  for (const { timer, ...rest } of items) {
    const row = rows.get(rest.id);
    if (row) row.timers.push(timer);
    else rows.set(rest.id, { ...rest, timers: [timer] });
  }
  return [...rows.values()];
}

function OverdueRow({ item, onOpen }: { item: OverdueRequest; onOpen: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="grid w-full gap-1 border-b px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("font-mono", overdueText(true))}>{item.order.order_no}</span>
          <TimerChips timers={item.timers} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {item.requester.name} · {item.order.client_name}
        </div>
      </div>
      <div className="text-sm font-semibold tabular-nums sm:text-right">
        {formatRupees(item.amount)}
      </div>
    </button>
  );
}

/** Full overview, above the review queue. Stage rows and the overdue tile filter the table. */
export function PaymentDashboard({
  onOpen,
  onStage,
  onOverdueOnly,
}: {
  onOpen: (id: number) => void;
  onStage: (status: WaitingStatus) => void;
  onOverdueOnly: () => void;
}) {
  const { data } = useQuery(dashboardQuery);
  if (!data) return null;
  const { overdue, waiting_on_you: mine, money, stages, threshold } = data;
  const overdueRequests = byRequest(overdue.items);
  const paidChange = money.paid_this_month.amount - money.paid_last_month.amount;

  return (
    <section className="mb-6 grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Waiting on you"
          value={mine.count}
          icon={Inbox}
          alert={mine.overdue > 0}
          hint={
            <>
              {mine.overdue > 0 && <span className={overdueText(true)}>{mine.overdue} overdue · </span>}
              {formatRupees(mine.amount)}
            </>
          }
        />
        <Tile
          label="Overdue"
          value={overdueRequests.length}
          icon={AlertTriangle}
          alert={overdue.total > 0}
          onClick={overdue.total > 0 ? onOverdueOnly : undefined}
          hint={overdue.total > 0 ? kindSummary(overdue.by_kind) : `Nothing past ${workingDays(threshold)}`}
        />
        <Tile
          label="To be paid"
          value={formatRupees(money.pending_payout)}
          icon={Wallet}
          hint={`${stages.PAYMENT_PENDING.count} approved ${stages.PAYMENT_PENDING.count === 1 ? "request" : "requests"}`}
        />
        <Tile
          label="Paid this month"
          value={formatRupees(money.paid_this_month.amount)}
          icon={Banknote}
          hint={`${money.paid_this_month.count} paid · last month ${formatRupees(money.paid_last_month.amount)}${
            paidChange === 0 ? "" : paidChange > 0 ? " ↑" : " ↓"
          }`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="surface-panel overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <div className="text-sm font-semibold">Overdue</div>
              <div className="text-xs text-muted-foreground">
                Waiting more than {workingDays(threshold)} (Sundays not counted), longest first
              </div>
            </div>
            {overdueRequests.length > SHOWN && (
              <button type="button" onClick={onOverdueOnly} className="whitespace-nowrap text-xs font-medium text-primary hover:underline">
                All {overdueRequests.length}
              </button>
            )}
          </div>
          {overdueRequests.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nothing is overdue.</div>
          ) : (
            overdueRequests.slice(0, SHOWN).map((item) => <OverdueRow key={item.id} item={item} onOpen={onOpen} />)
          )}
        </div>

        <div className="surface-panel overflow-hidden lg:col-span-2">
          <div className="border-b px-4 py-3 text-sm font-semibold">Where requests wait</div>
          {WAITING_STATUSES.map((s) => {
            const st = stages[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => onStage(s)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-4 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="truncate">{PAYMENT_STATUS_LABELS[s]}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatRupees(st.amount)}
                    {st.count > 0 && (
                      <>
                        {" · oldest "}
                        <span className={overdueText(st.oldest_days > threshold)}>{st.oldest_days}d</span>
                      </>
                    )}
                    {st.overdue > 0 && <span className={overdueText(true)}> · {st.overdue} overdue</span>}
                  </div>
                </div>
                <div className="text-lg font-semibold tabular-nums">{st.count}</div>
              </button>
            );
          })}
          {money.by_category.length > 0 && (
            <div className="border-t bg-muted/20 px-4 py-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Paid this month by category</div>
              <div className="grid gap-1 text-xs">
                {money.by_category.map((c) => (
                  <div key={c.category ?? "none"} className="flex justify-between gap-2">
                    <span>{c.category ? CATEGORY_LABELS[c.category] : "No category"}</span>
                    <span className="tabular-nums">{formatRupees(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A short card for the Admin dashboard: counts and the longest-waiting overdue items. */
export function PaymentOverviewCard() {
  const navigate = useNavigate();
  const { data } = useQuery(dashboardQuery);
  if (!data) return null;
  const d: PaymentDashboardData = data;
  const open = (id: number) => navigate({ href: `/admin/payments?open=${id}` });
  const overdueRequests = byRequest(d.overdue.items);

  return (
    <div className={cn("surface-panel overflow-hidden", d.overdue.total > 0 && "border-destructive/40")}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Hourglass className="h-4 w-4" /> Payment requests
        </div>
        <Link to="/admin/payments" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-3 divide-x border-b text-center">
        <div className="p-3">
          <div className="text-xl font-semibold tabular-nums">{d.waiting_on_you.count}</div>
          <div className="text-[11px] text-muted-foreground">Waiting on you</div>
        </div>
        <div className="p-3">
          <div className={cn("text-xl font-semibold tabular-nums", overdueText(overdueRequests.length > 0))}>
            {overdueRequests.length}
          </div>
          <div className="text-[11px] text-muted-foreground">Overdue</div>
        </div>
        <div className="p-3">
          <div className="text-xl font-semibold tabular-nums">{formatRupees(d.money.pending_payout)}</div>
          <div className="text-[11px] text-muted-foreground">To be paid</div>
        </div>
      </div>
      {overdueRequests.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground">
          Nothing has waited more than {workingDays(d.threshold)}.
        </div>
      ) : (
        overdueRequests.slice(0, 3).map((item) => <OverdueRow key={item.id} item={item} onOpen={open} />)
      )}
    </div>
  );
}
