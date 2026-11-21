import { UserRound } from "lucide-react";
import { useCsmDirectory } from "@/hooks/useCsmDirectory";
import { cn } from "@/lib/utils";

/** Names longer than this switch to the CSM code in compact spots. */
const LONG_NAME = 14;

/**
 * The CSM of an order, shown beside its order number everywhere so anyone with a doubt knows
 * whom to call. Full name normally; in `compact` spots a long name gives way to the CSM code
 * (or username), with the full name on hover.
 */
export function CsmTag({
  id,
  name,
  compact = false,
  className,
  withIcon = false,
}: {
  id?: number | null;
  name?: string | null;
  compact?: boolean;
  className?: string;
  withIcon?: boolean;
}) {
  const directory = useCsmDirectory();
  const entry = id != null ? directory.get(id) : undefined;
  const fullName = (name || entry?.name || "").trim();
  if (!fullName && !entry) return null;
  const short = entry?.code || entry?.username || fullName;
  const shown = compact && fullName.length > LONG_NAME ? short : fullName || short;
  const title = entry?.code ? `CSM: ${fullName} (${entry.code})` : `CSM: ${fullName}`;
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1 truncate text-[11px] text-muted-foreground", className)}
      title={title}
    >
      {withIcon && <UserRound className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="sr-only">CSM </span>
      <span className="truncate">{shown}</span>
    </span>
  );
}

/** " (code)" after a CSM's full name, when they have a CSM code. */
export function CsmCodeSuffix({ id }: { id?: number | null }) {
  const directory = useCsmDirectory();
  const code = id != null ? directory.get(id)?.code : null;
  return code ? <span className="ml-1 font-normal text-muted-foreground">({code})</span> : null;
}
