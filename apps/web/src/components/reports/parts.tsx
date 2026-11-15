import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/kpi/KpiCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useRowLink, type RowLinkTarget } from "@/hooks/useRowLink";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How report figures read. A missing figure is a dash, never a zero that reads as a result. */
export const fmt = {
  inr: (v: number | null | undefined) => (v == null ? "—" : inr(v)),
  n: (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("en-IN")),
  days: (v: number | null | undefined) => (v == null ? "—" : `${v} ${v === 1 ? "day" : "days"}`),
  pct: (v: number | null | undefined) => (v == null ? "—" : `${v}%`),
  hours: (v: number | null | undefined) => (v == null ? "—" : `${v} h`),
  date: (v: string | null | undefined) =>
    v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : "—",
  /** Signed money: + billed more, − billed less. */
  signed: (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${inr(Math.abs(v))}`),
};

/** Turns an API code like BillingCompleted or CCM_REVIEW into words. */
export const words = (s: string | null | undefined) =>
  !s
    ? "—"
    : s.includes("_") || s === s.toUpperCase()
      ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ")
      : s.replace(/([a-z])([A-Z])/g, "$1 $2");

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-panel min-w-0 break-inside-avoid p-4 sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface Stat {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "primary" | "success" | "warning" | "info" | "orange";
}

export function StatGrid({ items }: { items: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {items.map((s) => (
        <KpiCard key={s.label} label={s.label} value={s.value} hint={s.hint} accent={s.accent ?? "primary"} />
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  align?: "right";
  render?: (row: T) => ReactNode;
  className?: string;
}

/**
 * A report table. Long lists show the first `limit` rows with a "Show all" button; the
 * Excel export always has every row. Rows with a link open their order when clicked.
 */
export function DataTable<T extends Record<string, any>>({
  rows,
  columns,
  rowLink,
  empty = "Nothing in this range.",
  limit = 10,
}: {
  rows: T[];
  columns: Column<T>[];
  rowLink?: (row: T) => RowLinkTarget | null;
  empty?: string;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const linkProps = useRowLink();
  const shown = all ? rows : rows.slice(0, limit);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      <div className="-mx-4 overflow-x-auto sm:-mx-5">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {columns.map((c) => (
                <TableHead key={c.key} className={cn("whitespace-nowrap text-xs", c.align === "right" && "text-right")}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, i) => {
              const { className, ...handlers } = linkProps(rowLink?.(row));
              return (
                <TableRow key={row.key ?? row.id ?? row.order_id ?? row.user_id ?? i} {...handlers} className={className}>
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn("text-sm", c.align === "right" && "whitespace-nowrap text-right tabular-nums", c.className)}
                    >
                      {c.render ? c.render(row) : (row[c.key] ?? "—")}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {rows.length > limit && (
        <div className="mt-3 flex justify-center print:hidden">
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </Button>
        </div>
      )}
    </>
  );
}

/** Ranked horizontal bars: each as a share of the biggest value, with the figure beside it. */
export function BarList({
  rows,
  format = fmt.n,
  color = "var(--color-primary)",
  empty = "Nothing in this range.",
}: {
  rows: { label: string; value: number; sub?: string }[];
  format?: (v: number) => string;
  color?: string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium" title={r.label}>
              {r.label}
              {r.sub && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const tooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  fontSize: 12,
};

const shortInr = (v: number) =>
  Math.abs(v) >= 1e7
    ? `₹${(v / 1e7).toFixed(1)}Cr`
    : Math.abs(v) >= 1e5
      ? `₹${(v / 1e5).toFixed(1)}L`
      : Math.abs(v) >= 1e3
        ? `₹${(v / 1e3).toFixed(0)}k`
        : `₹${v}`;

/** Grouped bars over months (or days), one colour per series. */
export function TrendChart({
  data,
  series,
  money = false,
  xKey = "label",
}: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  money?: boolean;
  xKey?: string;
}) {
  return (
    <div className="h-64 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey={xKey} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
          <YAxis
            stroke="var(--color-muted-foreground)"
            fontSize={11}
            tickLine={false}
            width={money ? 56 : 36}
            allowDecimals={false}
            tickFormatter={money ? shortInr : undefined}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
            formatter={(v: number, name: string) => [money ? inr(v) : Number(v).toLocaleString("en-IN"), name]}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Small coloured label for a status word. */
export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" | "bad" | "good" | "info" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    warn: "bg-warning/15 text-amber-700 dark:text-amber-400",
    bad: "bg-destructive/10 text-destructive",
    good: "bg-success/15 text-success",
    info: "bg-info/15 text-info",
  };
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

export const COLORS = {
  primary: "var(--color-primary)",
  orange: "var(--color-brand-orange)",
  success: "var(--color-success)",
  info: "var(--color-info)",
  bad: "var(--color-destructive)",
};
