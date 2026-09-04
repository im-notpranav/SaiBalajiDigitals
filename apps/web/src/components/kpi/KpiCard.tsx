import { motion } from "framer-motion";
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
}

const accents = {
  primary: "from-primary/15 to-primary/0 text-primary",
  success: "from-success/15 to-success/0 text-success",
  warning: "from-warning/20 to-warning/0 text-warning-foreground",
  info: "from-info/15 to-info/0 text-info",
  orange: "from-brand-orange/20 to-brand-orange/0 text-brand-orange",
};

export function KpiCard({ label, value, hint, icon: Icon, trend, accent = "primary", delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-2xl border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated sm:p-5"
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70", accents[accent])} />
      <div className="relative flex items-start justify-between gap-2">
        {/* min-w-0 lets this column shrink below its content width. Without it a long
            figure like ₹3,37,960 pushes past the card and gets clipped on a phone. */}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</div>
          <div className="mt-2 truncate text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-xl border bg-background/60 p-2 backdrop-blur sm:p-2.5", accents[accent])}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        )}
      </div>
      {trend && (
        <div className="relative mt-3 inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-xs backdrop-blur">
          <span className={trend.positive ? "text-success" : "text-destructive"}>{trend.value}</span>
          <span className="text-muted-foreground">vs last period</span>
        </div>
      )}
    </motion.div>
  );
}
