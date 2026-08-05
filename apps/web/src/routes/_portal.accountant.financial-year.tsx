import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchFinancialYearConfig } from "@/api/dashboard";
import { CalendarClock, Hash } from "lucide-react";

export const Route = createFileRoute("/_portal/accountant/financial-year")({
  head: () => ({ meta: [{ title: "Financial Year - SB OMS" }] }),
  component: () => {
    const { data, isLoading } = useQuery({
      queryKey: ["financial-year-config"],
      queryFn: fetchFinancialYearConfig,
    });

    return (
      <>
        <PageHeader
          title="Financial Year"
          description="View the current active financial year settings."
          crumbs={[{ label: "Accountant" }, { label: "Financial Year" }]}
        />
        
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-panel p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Current FY Settings</div>
            
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4 rounded-lg border bg-background p-4">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Current Year Suffix</div>
                    <div className="font-semibold text-lg">{data?.year_code || "—"}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 rounded-lg border bg-background p-4">
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <Hash className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Last Order Number</div>
                    <div className="font-semibold text-lg font-mono">
                      ORD{data?.year_code}{String(data?.last_number || 0).padStart(4, "0")}
                    </div>
                  </div>
                </div>
                
                <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                  <p><strong>Note:</strong> The financial year runs June 1 through May 31. On June 1st, the year suffix rolls over (e.g. 25 to 26) and the sequence restarts from 0013 (first 12 numbers are reserved).</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  },
});
