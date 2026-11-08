import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive?: boolean };
  accent?: "primary" | "success" | "warning" | "info" | "orange";
  delay?: number;
  /** Makes the whole card a link to the page behind the number. */
  to?: string;
  search?: Record<string, unknown>;
  /** Makes the whole card a button, for a number whose detail is on the same page. */
  onClick?: () => void;
  /** What clicking does, in a few words. Shown on the card so nobody has to guess. */
  cta?: string;
}

const accents = {
  primary: "from-primary/15 to-primary/0 text-primary",
  success: "from-success/15 to-success/0 text-success",
  warning: "from-warning/20 to-warning/0 text-warning-foreground",
  info: "from-info/15 to-info/0 text-info",
  orange: "from-brand-orange/20 to-brand-orange/0 text-brand-orange",
};

// Average advance of a ₹-formatted figure's glyphs in bold Inter, in ems (commas are
// narrow, digits wide). Measured ~0.52; the slack keeps it inside the card if Inter
// hasn't loaded and a wider system font stands in.
const GLYPH_EM = 0.58;

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  accent = "primary",
  delay = 0,
  to,
  search,
  onClick,
  cta,
}: KpiCardProps) {
  const text = String(value);
  // Shrink the figure to fit the card's width. A five-across row leaves ~140px per
  // card, and ₹1,23,45,678 at full size is ~200px — truncating it hid the very number
  // the card exists to show. 100cqi is the value row's own width; the size is capped
  // at the design size (1.5rem phone, 1.875rem sm+) so short values look unchanged.
  const fontSize = `min(var(--kpi-max), calc(100cqi / ${Math.max(text.length, 1) * GLYPH_EM}))`;
  const interactive = !!to || !!onClick;

  const body = (
    <>
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70", accents[accent])} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
          {label}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-xl border bg-background/60 p-2 backdrop-blur sm:p-2.5", accents[accent])}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
          </div>
        )}
      </div>
      {/* The value gets the full card width, not the column beside the icon. */}
      <div className="relative mt-2 [container-type:inline-size] [--kpi-max:1.5rem] sm:[--kpi-max:1.875rem]">
        <div
          className="whitespace-nowrap font-bold leading-tight tabular-nums tracking-tight text-foreground"
          style={{ fontSize }}
          title={text}
        >
          {value}
        </div>
      </div>
      {hint && <div className="relative mt-1 text-xs text-muted-foreground">{hint}</div>}
      {trend && (
        <div className="relative mt-3 inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-xs backdrop-blur">
          <span className={trend.positive ? "text-success" : "text-destructive"}>{trend.value}</span>
          <span className="text-muted-foreground">vs last period</span>
        </div>
      )}
      {interactive && (
        <div className="relative mt-auto flex items-center gap-1 pt-2 text-xs font-medium text-primary">
          {cta ?? "View"}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
      )}
    </>
  );

  const className = cn(
    "group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-soft transition-all sm:p-5",
    // Only something that can be clicked may look as if it can be.
    interactive &&
      "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  );

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      {to ? (
        <Link to={to} search={search as never} className={className}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={className}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </motion.div>
  );
}
