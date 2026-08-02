import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchOverdueReport } from "@/api/dashboard";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Loader2, AlarmClock, AlertCircle, CheckCircle2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { inr } from "@/lib/format";
import { format } from "date-fns";

export const Route = createFileRoute("/_portal/admin/overdue")({
  head: () => ({ meta: [{ title: "Overdue Orders — SB OMS" }] }),
  component: OverduePage,
});

function OverduePage() {
  const [daysInput, setDaysInput] = useState("5");
  const [threshold, setThreshold] = useState(5);

  const { data, isLoading, error } = useQuery({
    queryKey: ["overdue-report", threshold],
    queryFn: () => fetchOverdueReport(threshold),
  });

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Math.max(0, Math.floor(Number(daysInput) || 0));
    setThreshold(n);
  };

  const byStage = data ? Object.entries(data.by_stage) : [];

  return (
    <>
      <PageHeader
        title="Overdue Orders"
        description="Open orders stuck at their current stage longer than the threshold."
        crumbs={[{ label: "Administrator" }, { label: "Reports" }, { label: "Overdue" }]}
      />

      <div className="space-y-6">
        <section className="surface-panel p-6">
          <form onSubmit={apply} className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 w-full space-y-2 max-w-xs">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <AlarmClock className="w-3.5 h-3.5" /> Stuck for more than (days)
              </label>
              <Input type="number" min={0} value={daysInput} onChange={(e) => setDaysInput(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full sm:w-auto">Update</Button>
          </form>
        </section>

        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : error ? (
          <div className="p-8 text-destructive surface-panel flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> Failed to load report.
          </div>
        ) : data && data.orders.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground surface-panel">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p>No orders stuck for more than {data.threshold} day{data.threshold === 1 ? "" : "s"}. All on track.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 surface-panel p-0 overflow-hidden">
              <div className="p-6 border-b flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider">Stuck Orders</h3>
                <span className="text-xs text-muted-foreground">{data?.count} overdue</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Stuck At</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">
                        {o.order_no}
                        <div className="text-xs text-muted-foreground font-normal mt-0.5">{o.client_name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={o.status} />
                          <span className="text-xs text-muted-foreground">{o.stage}</span>
                          <span className="text-[10px] text-muted-foreground">since {format(new Date(o.stage_since), "MMM d")}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-semibold ${o.days_in_stage >= 10 ? "text-destructive" : "text-amber-600 dark:text-amber-500"}`}>
                          {o.days_in_stage}d
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{inr(o.total_amount || 0)}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/admin/orders/$id"
                          params={{ id: String(o.id) }}
                          className={buttonVariants({ size: "sm", variant: "ghost" })}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>

            <section className="space-y-6">
              <div className="surface-panel p-6">
                <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Overdue</div>
                <div className="text-4xl font-bold text-destructive">{data?.count}</div>
                <div className="mt-2 text-xs text-muted-foreground">stuck &gt; {data?.threshold} days</div>
              </div>

              <div className="surface-panel p-6">
                <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">By Stage</div>
                <div className="space-y-3">
                  {byStage.map(([stage, count]) => (
                    <div key={stage} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{stage}</span>
                      <span className="font-semibold">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
