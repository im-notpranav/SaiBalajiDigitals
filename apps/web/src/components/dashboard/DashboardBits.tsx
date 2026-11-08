import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CalendarIcon,
  ChevronDown,
  Clock,
  HelpCircle,
  Info,
  X,
} from "lucide-react";
import { differenceInCalendarDays, format, isToday, subDays } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The pieces every role's dashboard is built from, so a number, a colour or a date filter
 * means the same thing on each of them.
 */

/* ------------------------------------------------------------------ waiting time */

export interface AgingThresholds {
  /** Amber above this many working days. */
  warn: number;
  /** Red above this many working days. */
  severe: number;
}

export const STAGE_AGING: AgingThresholds = { warn: 3, severe: 7 };

export function agingLevel(days: number, t: AgingThresholds = STAGE_AGING) {
  if (days > t.severe) return "severe" as const;
  if (days > t.warn) return "warning" as const;
  return "normal" as const;
}

/** Days waiting. Icon as well as colour, so the level doesn't rest on colour alone. */
export function AgingBadge({ days, thresholds }: { days: number; thresholds?: AgingThresholds }) {
  const level = agingLevel(days, thresholds);
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-mono text-[11px]",
        level === "severe" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
        level === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        level === "normal" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      {level === "severe" && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {level === "warning" && <Clock className="h-3 w-3" aria-hidden />}
      {days}d
      <span className="sr-only"> working days</span>
    </Badge>
  );
}

/** Says what the badge colours mean, next to any table that uses them. */
export function AgingLegend({
  thresholds = STAGE_AGING,
  className,
}: {
  thresholds?: AgingThresholds;
  className?: string;
}) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      <span>Working days, Sundays not counted:</span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /> up to {thresholds.warn} is fine
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3 text-amber-600" aria-hidden /> {thresholds.warn + 1}–{thresholds.severe} is getting late
      </span>
      <span className="inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3 text-red-600" aria-hidden /> over {thresholds.severe} needs action
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ date range */

export interface DateRange {
  from: Date;
  to: Date;
}

/** A rolling window, not the calendar month: an order dated last month can still be in flight. */
export function useDateRange(days = 90) {
  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return { from: subDays(now, days), to: now };
  });
  return {
    range,
    setRange,
    from: format(range.from, "yyyy-MM-dd"),
    to: format(range.to, "yyyy-MM-dd"),
    widen: () => {
      const now = new Date();
      setRange({ from: subDays(now, 365), to: now });
    },
  };
}

const PRESETS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

/**
 * Which orders the page counts, by order date. Picking one end past the other moves the other
 * end along with it, so the range can never come out backwards and quietly show nothing.
 */
export function DateRangeControl({
  range,
  onChange,
  className,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<"from" | "to" | null>(null);
  const span = differenceInCalendarDays(range.to, range.from);

  const end = (key: "from" | "to", label: string) => (
    <Popover open={open === key} onOpenChange={(o) => setOpen(o ? key : null)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          aria-label={`${label} date, ${format(range[key], "d MMMM yyyy")}. Change`}
        >
          <CalendarIcon className="h-3.5 w-3.5" aria-hidden />
          {format(range[key], "dd MMM yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={range[key]}
          defaultMonth={range[key]}
          onSelect={(d) => {
            if (!d) return;
            setOpen(null);
            if (key === "from") onChange({ from: d, to: d > range.to ? d : range.to });
            else onChange({ from: d < range.from ? d : range.from, to: d });
          }}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="group" aria-label="Order date range">
      <span className="text-xs font-medium text-muted-foreground">Orders dated</span>
      {end("from", "From")}
      <span className="text-xs text-muted-foreground">to</span>
      {end("to", "To")}
      <div className="flex gap-1">
        {PRESETS.map((p) => {
          const active = span === p.days && isToday(range.to);
          return (
            <button
              key={p.days}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const now = new Date();
                onChange({ from: subDays(now, p.days), to: now });
              }}
              className={cn(
                "h-9 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ explaining the page */

/** A short, plain explanation of the page, folded away for people who already know it. */
export function DashboardGuide({ title = "How to read this page", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="group mb-4 rounded-xl border bg-card text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <HelpCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {title}
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="grid gap-2 border-t px-4 py-3 text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </details>
  );
}

/** A section heading with a sentence saying what the section shows. */
export function SectionHeading({
  title,
  description,
  action,
  id,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-2", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ what needs doing */

export interface AttentionItem {
  key: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
  cta: string;
  to?: string;
  search?: Record<string, unknown>;
  onClick?: () => void;
}

const TONES = {
  danger: { icon: AlertTriangle, box: "border-destructive/40 bg-destructive/5", mark: "text-destructive" },
  warning: { icon: Clock, box: "border-warning/50 bg-warning/10", mark: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, box: "border-info/40 bg-info/5", mark: "text-info" },
};

/** The dashboard's first answer: what wants doing, each row going straight to where it gets done. */
export function AttentionList({ items, className }: { items: AttentionItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs your attention" className={cn("grid gap-2", className)}>
      {items.map((item) => {
        const tone = TONES[item.tone];
        const Icon = tone.icon;
        const row = cn(
          "flex w-full min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone.box,
        );
        const inner = (
          <>
            <Icon className={cn("h-4 w-4 shrink-0", tone.mark)} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{item.title}</span>
              <span className="block text-xs text-muted-foreground">{item.detail}</span>
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary">
              {item.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </>
        );
        return item.to ? (
          <Link key={item.key} to={item.to} search={item.search as never} className={row}>
            {inner}
          </Link>
        ) : (
          <button key={item.key} type="button" onClick={item.onClick} className={row}>
            {inner}
          </button>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ small helpers */

/** Tell someone what a list is narrowed to, and let them drop it. */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 py-0.5 pl-3 pr-1 text-xs font-medium text-primary">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear filter: ${label}`}
        className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

/**
 * A wide table's scroller. Focusable, so it can be scrolled from the keyboard too. Relative, so
 * screen-reader-only text inside the table is clipped with it and can't widen the whole page.
 */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {children}
    </div>
  );
}

/** Bring a section of the page into view, without the glide for people who asked for less motion. */
export function scrollToSection(id: string) {
  requestAnimationFrame(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  });
}

export function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
