import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LOCALITY_LABELS, type Locality } from "@/api/masterLibrary";

/** Rows of grey bars the height of real rows, so the table does not jump when the data lands. */
export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r} className="hover:bg-transparent" aria-hidden>
          {Array.from({ length: cols }, (_, c) => (
            <TableCell key={c} className="py-3">
              <Skeleton className={cn("h-4", c === 0 ? "w-40 max-w-full" : c === cols - 1 ? "ml-auto w-24" : "w-20")} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** A round filter button, as on the WhatsApp log. */
export function FilterPill({
  active,
  onClick,
  children,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  tone?: "warning";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? tone === "warning"
            ? "border-warning bg-warning text-warning-foreground"
            : "border-primary bg-primary text-primary-foreground"
          : "hover:bg-muted",
      )}
    >
      {children}
      {count !== undefined && <span className="tabular-nums opacity-70">{count.toLocaleString("en-IN")}</span>}
    </button>
  );
}

export function ArchivedBadge() {
  return <Badge variant="secondary" className="font-medium">Archived</Badge>;
}

export function ReviewBadge() {
  return (
    <Badge variant="outline" className="border-warning/40 font-medium text-warning">
      Needs review
    </Badge>
  );
}

export function LocalityBadge({ locality, review }: { locality?: Locality; review?: boolean }) {
  if (!locality || review) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={cn("font-medium", locality === "NON_LOCAL" && "border-orange-500/40 text-orange-600")}>
      {LOCALITY_LABELS[locality]}
    </Badge>
  );
}

/** Small count bubble on a tab. */
export function CountBubble({ n, tone }: { n: number; tone?: "warning" }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        tone === "warning" ? "bg-warning text-warning-foreground" : "bg-primary text-primary-foreground",
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
