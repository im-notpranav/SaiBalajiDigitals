import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { Check, GitPullRequestArrow, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CsmTag } from "@/components/orders/CsmTag";
import { CHANGE_STATUS_STYLE } from "@/components/orders/RequestChange";
import { approveChangeRequest, fetchChangeQueue, rejectChangeRequest, type QueueRow } from "@/api/changeRequests";
import { decideOrderAdjustment, setItemLossRemark } from "@/api/orders";
import { useAuth } from "@/lib/auth-store";
import { friendlyError } from "@/lib/friendly-error";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/admin/change-requests")({
  head: () => ({ meta: [{ title: "Change Requests — SB OMS" }] }),
  component: ChangeRequestsPage,
});

type Tab = "pending" | "decided";

/**
 * Everything a CSM has asked to change, in one queue: Request Change edits and combines,
 * whole-order Extra / Less Amounts, and line remarks (Reprint, Sample, Under Warranty, Free of Cost).
 */
function ChangeRequestsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("pending");
  const [deciding, setDeciding] = useState<{ row: QueueRow; action: "approve" | "reject" } | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["change-requests", "queue", tab],
    queryFn: () => fetchChangeQueue(tab),
  });
  const rows = data?.requests ?? [];
  const canDecide = user?.role === "ADMIN";

  return (
    <>
      <PageHeader
        title="Change Requests"
        description="What CSMs have asked to change on their orders. Nothing applies until you approve it."
        crumbs={[{ label: "Automated System" }, { label: "Change Requests" }]}
      />
      <div className="mb-4 inline-flex rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="Which requests">
        {(["pending", "decided"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("rounded-md px-4 py-1.5 font-medium", tab === t ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {t === "pending" ? "Waiting" : "Decided"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={GitPullRequestArrow}
          title={tab === "pending" ? "Nothing waiting" : "Nothing decided yet"}
          description={tab === "pending" ? "New requests from CSMs show here." : "Approved and rejected requests show here."}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.source}-${r.id}`} className="surface-panel grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/admin/orders/$id"
                    params={{ id: String(r.order.id) }}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {r.order.order_no}
                  </Link>
                  <CsmTag id={r.order.created_by} name={r.order.creator_name} compact />
                  <span className="text-sm text-muted-foreground">{r.order.client_name}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{r.label}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", CHANGE_STATUS_STYLE[r.status])}>
                    {r.status.toLowerCase()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{r.summary}</p>
                {r.reason && r.kind !== "OTHER" && <p className="text-xs text-muted-foreground">Reason: {r.reason}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {r.requester?.name ?? "—"} · {format(new Date(r.created_at), "dd MMM yyyy, h:mm a")}
                  {r.decided_at && ` · ${r.status.toLowerCase()} by ${r.decider?.name ?? "admin"} ${format(new Date(r.decided_at), "dd MMM")}`}
                  {r.decision_note && ` · ${r.decision_note}`}
                </p>
              </div>
              {canDecide && r.status === "PENDING" && (
                <div className="flex gap-2 sm:flex-col">
                  <Button size="sm" onClick={() => setDeciding({ row: r, action: "approve" })}>
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, action: "reject" })}>
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deciding && <DecideDialog row={deciding.row} action={deciding.action} onClose={() => setDeciding(null)} />}
    </>
  );
}

function DecideDialog({ row, action, onClose }: { row: QueueRow; action: "approve" | "reject"; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : "");
  const approve = action === "approve";

  const decide = useMutation({
    mutationFn: async () => {
      const trimmed = note.trim();
      if (row.source === "change") {
        return approve ? approveChangeRequest(row.id, trimmed) : rejectChangeRequest(row.id, trimmed);
      }
      if (row.source === "adjustment") {
        return decideOrderAdjustment(row.order.id, row.id, {
          action,
          amount: approve ? Number(amount) : undefined,
          note: trimmed || null,
        });
      }
      // A line remark: confirming saves the same remark as the admin; rejecting clears it.
      return setItemLossRemark(
        row.order.id,
        row.id,
        approve
          ? { remarks: row.kind, remarks_other_text: row.reason || null, decision_note: trimmed || null }
          : { remarks: null, decision_note: trimmed },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests"] });
      qc.invalidateQueries({ queryKey: ["order"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success(approve ? "Approved" : "Rejected", { description: "The CSM has been told." });
      onClose();
    },
    onError: (e) => toast.error(approve ? "Not approved" : "Not rejected", { description: friendlyError(e) }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approve ? "Approve" : "Reject"} {row.label} · {row.order.order_no}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">{row.summary}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!approve && note.trim().length < 3) return void toast.error("Say why it is rejected.");
            if (approve && row.source === "adjustment" && !(Number(amount) > 0)) return void toast.error("Enter the amount.");
            decide.mutate();
          }}
        >
          {approve && row.source === "adjustment" && (
            <div className="space-y-1.5">
              <Label htmlFor="decide-amount">Amount (₹), change it if needed</Label>
              <Input id="decide-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              {row.amount != null && Number(amount) !== row.amount && <p className="text-xs text-muted-foreground">Asked for {inr(row.amount)}.</p>}
            </div>
          )}
          {approve && row.source === "change" && row.kind === "LINE_EDIT" && (
            <p className="text-xs text-muted-foreground">
              The lines change exactly as asked and are marked Revised. To use other figures, approve and then edit the order, or reject with a note.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="decide-note">{approve ? "Note to the CSM (optional)" : "Why it is rejected *"}</Label>
            <Textarea id="decide-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={approve ? "default" : "destructive"} disabled={decide.isPending}>
              {decide.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {approve ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
