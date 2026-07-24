import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Filter } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
import { AUDIT } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/admin/audit")({
  head: () => ({ meta: [{ title: "Audit Log — SB OMS" }] }),
  component: AuditPage,
});

function AuditPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("all");
  const actions = useMemo(() => Array.from(new Set(AUDIT.map((a) => a.action))), []);

  const filtered = AUDIT.filter(
    (a) =>
      (action === "all" || a.action === action) &&
      `${a.actor} ${a.target} ${a.detail}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Audit Log Viewer"
        description="Read-only investigation tool. System-triggered noise is suppressed via app.skip_audit."
        crumbs={[{ label: "Administrator" }, { label: "Audit Logs" }]}
      />

      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by user, order, or detail" className="pl-9" />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[220px]">
            <Filter className="mr-2 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto text-xs text-muted-foreground">{filtered.length} entries</div>
      </div>

      <div className="surface-panel overflow-hidden">
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
            {filtered.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(a.at), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <div className="font-semibold">{a.actor}</div>
                  <div className="text-xs text-muted-foreground">{a.role}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">{a.action}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-primary">{a.target}</TableCell>
                <TableCell className="text-sm">{a.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
