import { cn } from "@/lib/utils";

/**
 * The two Work Allocation Sheet views, named as marks: OMS-WAS is the app's own live grid,
 * GS-WAS the team's Google Sheet. The source (OMS or GS) is brand blue, WAS brand orange.
 */
export type WasKind = "OMS" | "GS";

export function WasMark({ kind, className }: { kind: WasKind; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline font-semibold tracking-tight", className)}>
      <span className="text-primary">{kind}</span>
      <span className="px-px text-muted-foreground/60">-</span>
      <span className="text-orange-600 dark:text-orange-400">WAS</span>
    </span>
  );
}
