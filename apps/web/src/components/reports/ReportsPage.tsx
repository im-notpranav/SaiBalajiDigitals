import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportReport, fetchReport, fetchReportOptions, type ReportQuery, type ReportTab } from "@/api/reports";
import type { RowLinkTarget } from "@/hooks/useRowLink";
import { cn } from "@/lib/utils";
import {
  AllocationTab,
  CsmTab,
  MastersTab,
  MoneyTab,
  OrdersTab,
  PaymentsTab,
  ProductionTab,
  SystemTab,
  type TabProps,
} from "./tabs";
import { DelayTab, PrintingTab, TurnoverTab } from "./tabs-extra";

/** What each tab is called, what the dates mean on it, and which filters it takes. */
const TAB_INFO: Record<ReportTab, { label: string; dates: string; csm?: boolean; client?: boolean; operator?: boolean; view: ComponentType<TabProps> }> = {
  printing: {
    label: "Printing",
    dates: "Lines started or finished between these dates. An operator sees only their own lines.",
    csm: true,
    client: true,
    operator: true,
    view: PrintingTab,
  },
  turnover: {
    label: "Turnover",
    dates: "Orders raised, invoices billed and payments received between these dates.",
    csm: true,
    client: true,
    view: TurnoverTab,
  },
  delay: {
    label: "Delay",
    dates: "Orders raised between these dates, with the days they spent in each stage.",
    csm: true,
    client: true,
    view: DelayTab,
  },
  orders: {
    label: "Orders",
    dates: "Orders created, and orders closed, between these dates. Open orders and stages are as of now.",
    csm: true,
    client: true,
    view: OrdersTab,
  },
  money: {
    label: "Money",
    dates: "Invoices billed and payments received between these dates. Outstanding and not-billed are as of now.",
    csm: true,
    client: true,
    view: MoneyTab,
  },
  csm: {
    label: "CSMs",
    dates: "Orders each person created between these dates, and field jobs running in them.",
    client: true,
    view: CsmTab,
  },
  production: {
    label: "Production",
    dates: "Items assigned or finished between these dates. Holds and unassigned items are as of now.",
    view: ProductionTab,
  },
  allocation: {
    label: "Field work",
    dates: "Field jobs, leave and overtime on the days between these dates.",
    view: AllocationTab,
  },
  payments: {
    label: "Payment requests",
    dates: "Requests raised, and requests paid, between these dates. Open requests are as of now.",
    csm: true,
    client: true,
    view: PaymentsTab,
  },
  masters: {
    label: "Master Library",
    dates: "Usage is for all time; “in range” counts orders between these dates.",
    view: MastersTab,
  },
  system: {
    label: "System",
    dates: "WhatsApp messages and recorded changes between these dates. Logins are as of now.",
    view: SystemTab,
  },
};

export interface ReportsSearch {
  tab?: ReportTab;
  from?: string;
  to?: string;
  csm?: number;
  client?: string;
  operator?: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the page's URL search, so a report can be bookmarked or sent as a link. */
export function parseReportsSearch(s: Record<string, unknown>): ReportsSearch {
  const day = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) ? v : undefined);
  const csm = Number(s.csm);
  return {
    tab: typeof s.tab === "string" && s.tab in TAB_INFO ? (s.tab as ReportTab) : undefined,
    from: day(s.from),
    to: day(s.to),
    csm: Number.isInteger(csm) && csm > 0 ? csm : undefined,
    client: typeof s.client === "string" && s.client.trim() ? s.client : undefined,
    operator: Number.isInteger(Number(s.operator)) && Number(s.operator) > 0 ? Number(s.operator) : undefined,
  };
}

// ---------------------------------------------------------------------------------------
// Date presets, in India time.

const IST_MS = 330 * 60_000;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const shiftMonth = (day: string, by: number) => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};
const minusDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
const fyStart = (day: string) => {
  const y = Number(day.slice(0, 4));
  return `${Number(day.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};

function presets(): { key: string; label: string; from: string; to: string }[] {
  const t = todayIst();
  const fy = fyStart(t);
  const lastFy = `${Number(fy.slice(0, 4)) - 1}-04-01`;
  return [
    { key: "7d", label: "Last 7 days", from: minusDays(t, 6), to: t },
    { key: "30d", label: "Last 30 days", from: minusDays(t, 29), to: t },
    { key: "month", label: "This month", from: `${t.slice(0, 7)}-01`, to: t },
    { key: "lastMonth", label: "Last month", from: shiftMonth(t, -1), to: minusDays(`${t.slice(0, 7)}-01`, 1) },
    { key: "quarter", label: "Last 3 months", from: shiftMonth(t, -2), to: t },
    { key: "fy", label: "This financial year", from: fy, to: t },
    { key: "lastFy", label: "Last financial year", from: lastFy, to: minusDays(fy, 1) },
  ];
}

// ---------------------------------------------------------------------------------------

interface ReportsPageProps {
  /** The tabs this portal may see, in order. The API checks the role again. */
  tabs: ReportTab[];
  search: ReportsSearch;
  onSearch: (next: ReportsSearch) => void;
  title: string;
  description: string;
  crumbs: { label: string; to?: string }[];
  /** This portal's order page, so report rows open their order. */
  orderLink?: (id: number) => RowLinkTarget | null;
}

export function ReportsPage({ tabs, search, onSearch, title, description, crumbs, orderLink }: ReportsPageProps) {
  const ranges = useMemo(presets, []);
  const fy = ranges.find((p) => p.key === "fy")!;
  const tab = search.tab && tabs.includes(search.tab) ? search.tab : tabs[0]!;
  const info = TAB_INFO[tab];
  const from = search.from ?? fy.from;
  const to = search.to ?? fy.to;
  const query: ReportQuery = {
    from,
    to,
    csm: info.csm ? search.csm : undefined,
    client: info.client ? search.client : undefined,
    operator: info.operator ? search.operator : undefined,
  };
  const preset = ranges.find((p) => p.from === from && p.to === to)?.key ?? "custom";

  // Typed dates apply once both are whole days, so half-typed input never fires a request.
  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);
  useEffect(() => {
    setFromInput(from);
    setToInput(to);
  }, [from, to]);
  const set = (next: Partial<ReportsSearch>) => onSearch({ ...search, ...next });
  const applyDates = (f: string, t: string) => {
    if (DAY_RE.test(f) && DAY_RE.test(t) && f <= t) set({ from: f, to: t });
  };

  const options = useQuery({
    queryKey: ["report-options"],
    queryFn: fetchReportOptions,
    enabled: tabs.some((t) => TAB_INFO[t].csm || TAB_INFO[t].client),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["report", tab, query],
    queryFn: () => fetchReport(tab, query),
    // Keep the last figures on screen while new dates load, but never another tab's: each
    // tab's view reads its own shape.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === tab ? prev : undefined),
  });

  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      await exportReport(tab, query);
    } catch (e: any) {
      toast.error("Couldn't build the Excel file", { description: e?.message });
    } finally {
      setExporting(false);
    }
  };

  const View = info.view;

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        crumbs={crumbs}
        actions={
          <Button variant="outline" className="rounded-xl shadow-soft" onClick={download} disabled={exporting || isLoading}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Excel
          </Button>
        }
      />

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Report" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              onClick={() => set({ tab: t })}
              className={cn(
                "shrink-0 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                t === tab
                  ? "border-primary/40 bg-primary text-primary-foreground shadow-soft"
                  : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {TAB_INFO[t].label}
            </button>
          ))}
        </div>
      )}

      <section className="surface-panel mb-4 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
          <label className="col-span-2 grid gap-1.5 md:w-52">
            <span className="text-xs font-semibold text-muted-foreground">Period</span>
            <Select
              value={preset}
              onValueChange={(v) => {
                const p = ranges.find((x) => x.key === v);
                if (p) set({ from: p.from, to: p.to });
              }}
            >
              <SelectTrigger aria-label="Period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ranges.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom" disabled>
                  Custom dates
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 md:w-40">
            <span className="text-xs font-semibold text-muted-foreground">From</span>
            <Input
              type="date"
              value={fromInput}
              max={toInput}
              onChange={(e) => {
                setFromInput(e.target.value);
                applyDates(e.target.value, toInput);
              }}
            />
          </label>
          <label className="grid gap-1.5 md:w-40">
            <span className="text-xs font-semibold text-muted-foreground">To</span>
            <Input
              type="date"
              value={toInput}
              min={fromInput}
              onChange={(e) => {
                setToInput(e.target.value);
                applyDates(fromInput, e.target.value);
              }}
            />
          </label>
          {info.csm && (
            <label className="col-span-2 grid gap-1.5 md:col-span-1 md:w-52">
              <span className="text-xs font-semibold text-muted-foreground">Created by</span>
              <Select value={search.csm ? String(search.csm) : "all"} onValueChange={(v) => set({ csm: v === "all" ? undefined : Number(v) })}>
                <SelectTrigger aria-label="Created by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {(options.data?.csms ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                      {!c.active ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {info.client && (
            <label className="col-span-2 grid gap-1.5 md:col-span-1 md:w-56">
              <span className="text-xs font-semibold text-muted-foreground">Client</span>
              <Select value={search.client ?? "all"} onValueChange={(v) => set({ client: v === "all" ? undefined : v })}>
                <SelectTrigger aria-label="Client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every client</SelectItem>
                  {(options.data?.clients ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {info.operator && (data?.operators?.length ?? 0) > 0 && (
            <label className="col-span-2 grid gap-1.5 md:col-span-1 md:w-52">
              <span className="text-xs font-semibold text-muted-foreground">Operator</span>
              <Select value={search.operator ? String(search.operator) : "all"} onValueChange={(v) => set({ operator: v === "all" ? undefined : Number(v) })}>
                <SelectTrigger aria-label="Operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every operator</SelectItem>
                  {(data.operators as { id: number; name: string }[]).map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          {(search.csm || search.client || search.operator || search.from || search.to) && (
            <Button
              variant="ghost"
              size="sm"
              className="col-span-2 md:col-span-1"
              onClick={() => onSearch({ tab: search.tab })}
            >
              Reset
            </Button>
          )}
          {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-label="Updating" />}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{info.dates}</p>
      </section>

      {isLoading ? (
        <LoadingState label="Loading report…" />
      ) : error && !data ? (
        <ErrorState title="Couldn't load this report" error={error} onRetry={() => refetch()} />
      ) : data ? (
        <div className={cn("transition-opacity", isFetching && "opacity-60")}>
          <View data={data} orderLink={orderLink} />
        </div>
      ) : null}
    </>
  );
}
