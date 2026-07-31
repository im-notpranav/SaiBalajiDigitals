import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchLossReport } from "@/api/dashboard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingDown, Calendar, AlertCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inr } from "@/lib/format";
import { remarkLabel } from "@/lib/constants";
import { format, subDays } from "date-fns";

export const Route = createFileRoute("/_portal/admin/loss-report")({
  head: () => ({ meta: [{ title: "Loss Report — SB OMS" }] }),
  component: LossReportPage,
});

function LossReportPage() {
  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  
  const [queryDates, setQueryDates] = useState({ start: startDate, end: endDate });

  const { data, isLoading, error } = useQuery({
    queryKey: ["loss-report", queryDates.start, queryDates.end],
    queryFn: () => fetchLossReport(queryDates.start, queryDates.end),
  });

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setQueryDates({ start: startDate, end: endDate });
  };

  const totalLoss = useMemo(() => {
    if (!data?.items) return 0;
    return data.items.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
  }, [data?.items]);

  const byReason = useMemo(() => {
    if (!data?.items) return [];
    const grouped = data.items.reduce((acc: Record<string, { count: number; amount: number; label: string }>, item: any) => {
      const type = item.remarks || "Unknown";
      if (!acc[type]) acc[type] = { count: 0, amount: 0, label: item.remarks ? remarkLabel(item.remarks) : "Unknown" };
      acc[type].count += 1;
      acc[type].amount += (item.amount || 0);
      return acc;
    }, {});
    return Object.values(grouped).sort((a: any, b: any) => b.amount - a.amount);
  }, [data?.items]);

  return (
    <>
      <PageHeader
        title="Loss Report"
        description="Track financial loss from line items marked with loss remarks."
        crumbs={[{ label: "Administrator" }, { label: "Reports" }, { label: "Loss Report" }]}
      />
      
      <div className="space-y-6">
        <section className="surface-panel p-6">
          <form onSubmit={handleFilter} className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 w-full space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Start Date
              </label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div className="flex-1 w-full space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> End Date
              </label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full sm:w-auto">Update Report</Button>
          </form>
        </section>

        {isLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : error ? (
          <div className="p-8 text-destructive surface-panel flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> Failed to load report.
          </div>
        ) : data?.items?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground surface-panel">
            <TrendingDown className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p>No lost items found in this period.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 surface-panel p-0 overflow-hidden">
              <div className="p-6 border-b">
                <h3 className="text-sm font-semibold uppercase tracking-wider">Itemized Loss</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Media</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items?.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.order?.order_no || "Unknown"}
                        <div className="text-xs text-muted-foreground font-normal mt-0.5">{item.order?.client_name}</div>
                      </TableCell>
                      <TableCell>
                        {item.media}
                        <div className="text-xs text-muted-foreground mt-0.5">{item.width_inches}x{item.height_inches} • {item.qty} qty</div>
                      </TableCell>
                      <TableCell>
                        <span className="text-amber-600 dark:text-amber-500 font-medium">{remarkLabel(item.remarks)}</span>
                        {item.remarks_other_text && <div className="text-xs text-muted-foreground mt-0.5 max-w-[150px] truncate" title={item.remarks_other_text}>{item.remarks_other_text}</div>}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-destructive">
                        {inr(item.amount || 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            
            <section className="space-y-6">
              <div className="surface-panel p-6">
                <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Total Loss Value</div>
                <div className="text-4xl font-bold text-destructive">{inr(totalLoss)}</div>
                <div className="mt-2 text-xs text-muted-foreground">From {data?.items?.length} items</div>
              </div>
              
              <div className="surface-panel p-6">
                <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">By Reason</div>
                <div className="space-y-4">
                  {byReason.map((r: any) => (
                    <div key={r.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{r.label}</span>
                        <span className="font-semibold">{inr(r.amount)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{r.count} item{r.count !== 1 ? 's' : ''}</span>
                        <span>{((r.amount / totalLoss) * 100).toFixed(1)}%</span>
                      </div>
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
