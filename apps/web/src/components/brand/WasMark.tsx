import { cn } from "@/lib/utils";

/**
 * The two Work Allocation Sheet views, named as marks: OMS-WAS is the app's own live grid,
 * GS-WAS the team's Google Sheet. A split pill: the source (OMS or GS) on brand blue, WAS on
 * brand orange, white bold text. `muted` is the same pill in pale tints, for a view that is
 * not the one selected.
 */
export type WasKind = "OMS" | "GS";

const SIZES = {
  sm: "text-[11px] leading-none [&>span]:px-1.5 [&>span]:py-[3px]",
  md: "text-xs leading-none [&>span]:px-2 [&>span]:py-1",
  lg: "text-base leading-none [&>span]:px-2.5 [&>span]:py-1.5",
} as const;

export function WasMark({
  kind,
  size = "sm",
  muted = false,
  className,
}: {
  kind: WasKind;
  size?: keyof typeof SIZES;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${kind}-WAS`}
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-md font-bold tracking-wide",
        !muted && "shadow-sm",
        SIZES[size],
        className,
      )}
    >
      <span aria-hidden className={muted ? "bg-primary/15 text-primary" : "bg-primary text-primary-foreground"}>
        {kind}
      </span>
      <span
        aria-hidden
        className={muted ? "bg-orange-500/15 text-orange-700 dark:text-orange-300" : "bg-orange-600 text-white"}
      >
        WAS
      </span>
    </span>
  );
}
