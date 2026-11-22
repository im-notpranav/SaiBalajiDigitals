import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Check, ChevronRight, GitPullRequestArrow, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CsmTag } from "@/components/orders/CsmTag";
import { CHANGE_STATUS_STYLE } from "@/components/orders/RequestChange";
import { DecideDialog } from "@/components/change-requests/DecideDialog";
import { fetchChangeQueue, type QueueRow } from "@/api/changeRequests";
import { useAuth } from "@/lib/auth-store";
import { useRowLink } from "@/hooks/useRowLink";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/admin/change-requests")({
  head: () => ({ meta: [{ title: "Change Requests — SB OMS" }] }),
  component: ChangeRequestsPage,
});

type Tab = "pending" | "decided";

/**
 * Everything a CSM has asked to change, in one queue: Request Change edits and combines,
 * whole-order Extra / Less Amounts, and line remarks (Reprint, Sample, Under Warranty, Free of Cost).
 * A click anywhere on a request opens it beside the order, to compare before deciding.
 */
function ChangeRequestsPage() {
  const { user } = useAuth();
  const rowLink = useRowLink();
  const [tab, setTab] = useState<Tab>("pending");
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [deciding, setDeciding] = useState<{ row: QueueRow; action: "approve" | "reject" } | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["change-requests", "queue", tab],
    queryFn: () => fetchChangeQueue(tab),
  });
  const all = data?.requests ?? [];
  const canDecide = user?.role === "ADMIN";

  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) m.set(r.label, (m.get(r.label) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (kind === "all" || r.label === kind) &&
        (!needle ||
          r.order.order_no.toLowerCase().includes(needle) ||
          r.order.client_name.toLowerCase().includes(needle) ||
          (r.requester?.name ?? "").toLowerCase().includes(needle)),
    );
  }, [all, kind, q]);

  return (
    <>
      <PageHeader
        title="Change Requests"
        description="What CSMs have asked to change on their orders. Click a request to compare it with the order. Nothing applies until you approve it."
        crumbs={[{ label: "Automated System" }, { label: "Change Requests" }]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="Which requests">
          {(["pending", "decided"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setKind("all");
              }}
              className={cn("rounded-md px-4 py-1.5 font-medium", tab === t ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {t === "pending" ? "Waiting" : "Decided"}
              {t === tab && data && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{all.length}</span>}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order no, client or CSM" className="h-9 pl-8" aria-label="Search requests" />
        </div>
      </div>
      {kinds.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Request type">
          {[["all", all.length] as [string, number], ...kinds].map(([k, n]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                kind === k ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {k === "all" ? "All" : k} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={GitPullRequestArrow}
          title={all.length > 0 ? "No request matches" : tab === "pending" ? "Nothing waiting" : "Nothing decided yet"}
          description={all.length > 0 ? "Clear the search or pick another type." : tab === "pending" ? "New requests from CSMs show here." : "Approved and rejected requests show here."}
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const { className: linkClass, ...open } = rowLink({ to: "/admin/change-requests/$source/$id", params: { source: r.source, id: String(r.id) } });
            return (
              <li
                key={`${r.source}-${r.id}`}
                {...open}
                className={cn(
                  "surface-panel group grid gap-2 p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] sm:grid-cols-[1fr_auto] sm:items-start",
                  linkClass,
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/admin/change-requests/$source/$id"
                      params={{ source: r.source, id: String(r.id) }}
                      className="font-mono font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {r.order.order_no}
                    </Link>
                    <CsmTag id={r.order.created_by} name={r.order.creator_name} compact />
                    <span className="text-sm text-muted-foreground">{r.order.client_name}</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{r.label}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", CHANGE_STATUS_STYLE[r.status])}>{r.status.toLowerCase()}</span>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm">{r.summary}</p>
                  {r.reason && r.kind !== "OTHER" && <p className="line-clamp-2 text-xs text-muted-foreground">Reason: {r.reason}</p>}
                  <p className="text-[11px] text-muted-foreground">
                    {r.requester?.name ?? "—"} ·{" "}
                    <span title={format(new Date(r.created_at), "dd MMM yyyy, h:mm a")}>
                      {formatDistanceToNowStrict(new Date(r.created_at), { addSuffix: true })}
                    </span>
                    {r.decided_at && ` · ${r.status.toLowerCase()} by ${r.decider?.name ?? "admin"} ${format(new Date(r.decided_at), "dd MMM")}`}
                    {r.decision_note && ` · ${r.decision_note}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
                  {canDecide && r.status === "PENDING" && (
                    <>
                      <Button size="sm" onClick={() => setDeciding({ row: r, action: "approve" })}>
                        <Check className="mr-1 h-4 w-4" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, action: "reject" })}>
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </>
                  )}
                  <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-primary opacity-70 group-hover:opacity-100 sm:ml-0 sm:justify-center">
                    Compare <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {deciding && <DecideDialog row={deciding.row} action={deciding.action} onClose={() => setDeciding(null)} />}
    </>
  );
}
