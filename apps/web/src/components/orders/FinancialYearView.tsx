import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Hash, Info } from "lucide-react";
import { fetchFinancialYearConfig } from "@/api/dashboard";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";

/**
 * The current financial year's order-number suffix and last sequence number. Read-only, and
 * the same for the Admin and the Accountant, so both portals show this one panel.
 */
export function FinancialYearView() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["financial-year-config"],
    queryFn: fetchFinancialYearConfig,
  });

  if (isLoading) return <LoadingState label="Loading financial year…" className="lg:max-w-2xl" />;
  if (error && !data)
    return (
      <ErrorState
        className="lg:max-w-2xl"
        title="Couldn't load the financial year"
        error={error}
        onRetry={() => refetch()}
      />
    );

  return (
    <div className="surface-panel space-y-4 p-4 sm:p-6 lg:max-w-2xl">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Current FY Settings</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-4 rounded-lg border bg-background p-4">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <CalendarClock className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Current Year Suffix</div>
            <div className="text-lg font-semibold">{data?.year_code || "—"}</div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-lg border bg-background p-4">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Hash className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Last Order Number</div>
            <div className="truncate font-mono text-lg font-semibold">
              ORD{data?.year_code}
              {String(data?.last_number || 0).padStart(4, "0")}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg bg-info/10 p-4 text-sm text-info">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          The financial year runs June 1 through May 31. On June 1st, the year suffix rolls over
          (e.g. 25 to 26) and the sequence restarts from 0013 (first 12 numbers are reserved).
        </p>
      </div>
    </div>
  );
}
