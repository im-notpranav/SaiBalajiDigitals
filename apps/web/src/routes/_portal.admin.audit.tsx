import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Filter } from "lucide-react";
import { formatDistanceToNow, isAfter, subDays, subMonths } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditLog } from "@/api/dashboard";

export const Route = createFileRoute("/_portal/admin/audit")({
  head: () => ({ meta: [{ title: "Audit Log — SB OMS" }] }),
  component: AuditPage,
});

function AuditPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");

  const { data: auditData, isLoading } = useQuery({
    queryKey: ["audit", 1, 100],
    queryFn: () => fetchAuditLog(1, 100),
  });

  const logs = auditData?.logs || [];
  const actions = useMemo(() => Array.from(new Set(logs.map((a: any) => a.action))).filter(Boolean) as string[], [logs]);
  const users = useMemo(() => Array.from(new Set(logs.map((a: any) => a.user_name || String(a.changed_by)))).filter(Boolean) as string[], [logs]);

  const filtered = logs.filter((a: any) => {
    // Action filter
    if (action !== "all" && a.action !== action) return false;
    
    // User filter
    const actor = a.user_name || String(a.changed_by);
    if (userFilter !== "all" && actor !== userFilter) return false;
    
    // Date filter
    if (dateRange !== "all") {
      const logDate = new Date(a.changed_at);
      if (dateRange === "7d" && !isAfter(logDate, subDays(new Date(), 7))) return false;
      if (dateRange === "30d" && !isAfter(logDate, subDays(new Date(), 30))) return false;
      if (dateRange === "1m" && !isAfter(logDate, subMonths(new Date(), 1))) return false;
    }
    
    // Search filter
    const searchString = `${a.user_name || ""} ${a.changed_by} ${a.order_no || a.record_id} ${a.table_name}`.toLowerCase();
    if (q && !searchString.includes(q.toLowerCase())) return false;
    
    return true;
  });

  return (
    <>
      <PageHeader
        title="Audit Log Viewer"
        description="Read-only investigation tool. System-triggered noise is suppressed via app.skip_audit."
        crumbs={[{ label: "Administrator" }, { label: "Audit Logs" }]}
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-0 flex-1 sm:min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by user, order, or detail" className="pl-9" />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[180px]">
            <Filter className="mr-2 h-3.5 w-3.5" />
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a: any) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="mr-2 h-3.5 w-3.5" />
            <SelectValue placeholder="User" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((u: any) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[180px]">
            <Filter className="mr-2 h-3.5 w-3.5" />
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">{filtered.length} entries</div>
      </div>

      <div className="surface-panel overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading audit logs...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(a.changed_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{a.user_name || `User ID: ${a.changed_by}`}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">{a.action}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-primary">{a.order_no || a.record_id}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.table_name} table was updated.</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
