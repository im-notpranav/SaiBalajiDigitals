import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Loader2, RotateCw } from "lucide-react";
import { InlineBrandLoader } from "@/components/brand/BrandLoader";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The three states every data page passes through, drawn the same way everywhere: a quiet
 * loading line, an error that says so and offers a retry (instead of looking like "no data"),
 * and an empty state that explains what would appear here.
 */

/** The server's own message when there is one, so the person sees why it failed. */
export function errorText(err: unknown, fallback = "Something went wrong."): string {
  const data = (err as { response?: { data?: { message?: string; errors?: string[] } } })
    ?.response?.data;
  if (Array.isArray(data?.errors) && data.errors.length) return data.errors.join(", ");
  if (data?.message) return data.message;
  if (err instanceof Error && err.message === "Network Error")
    return "Can't reach the server. Check your connection.";
  return fallback;
}

export function LoadingState({
  label = "Loading…",
  className,
  bare,
}: {
  label?: string;
  className?: string;
  /** No panel of its own, for use inside a card or table that already has one. */
  bare?: boolean;
}) {
  if (!bare) return <InlineBrandLoader label={label} className={cn("surface-panel", className)} />;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({
  title = "Couldn't load this",
  error,
  onRetry,
  className,
  bare,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  bare?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 p-8 text-center",
        !bare && "surface-panel",
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {errorText(error, "Something went wrong. Try again in a moment.")}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="rounded-xl" onClick={onRetry}>
          <RotateCw className="mr-1.5 h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  bare,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 p-8 text-center",
        !bare && "surface-panel",
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * One full-width table row for a table's loading, error or empty state, so the header stays
 * in place and the message sits where the rows would be.
 */
export function TableStateRow({
  colSpan,
  loading,
  error,
  onRetry,
  empty,
  loadingLabel,
}: {
  colSpan: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode };
  loadingLabel?: string;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        {loading ? (
          <LoadingState bare label={loadingLabel} />
        ) : error ? (
          <ErrorState bare error={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState bare {...empty} />
        ) : null}
      </TableCell>
    </TableRow>
  );
}
