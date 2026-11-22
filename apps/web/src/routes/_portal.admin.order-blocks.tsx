import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, Loader2, Lock, Search, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  approveBlockException,
  blockReasonText,
  fetchBlockExceptions,
  fetchClientBlockSettings,
  rejectBlockException,
  updateClientBlockSettings,
  type BlockException,
  type ClientBlockSettings,
} from "@/api/orderBlocks";
import { friendlyError } from "@/lib/friendly-error";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/admin/order-blocks")({
  head: () => ({ meta: [{ title: "Order Blocks — SB OMS" }] }),
  component: OrderBlocksPage,
});

type Tab = "PENDING" | "DECIDED" | "CLIENTS";
const TABS: { id: Tab; label: string }[] = [
  { id: "PENDING", label: "Waiting" },
  { id: "DECIDED", label: "Decided" },
  { id: "CLIENTS", label: "Client settings" },
];

/**
 * Order-number blocks: CSMs' requests to open one order for a client on hold, and each
 * client's block settings (on/off, days for an open order, days for an unpaid bill).
 */
function OrderBlocksPage() {
  const [tab, setTab] = useState<Tab>("PENDING");
  return (
    <>
      <PageHeader
        title="Order Blocks"
        description="A client with an order open too long or a bill unpaid too long takes no new order from a CSM until you allow one."
        crumbs={[{ label: "Automated System" }, { label: "Order Blocks" }]}
      />
      <div className="mb-4 inline-flex rounded-lg bg-muted p-1 text-sm" role="tablist" aria-label="Order blocks">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("rounded-md px-4 py-1.5 font-medium", tab === t.id ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "CLIENTS" ? <ClientSettings /> : <Exceptions decided={tab === "DECIDED"} />}
    </>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-warning/15 text-warning",
  APPROVED: "bg-success/15 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
};

function Exceptions({ decided }: { decided: boolean }) {
  const [deciding, setDeciding] = useState<{ row: BlockException; approve: boolean } | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["order-blocks", "exceptions", decided ? "decided" : "pending"],
    queryFn: () => fetchBlockExceptions(decided ? undefined : "PENDING"),
  });
  const rows = (data?.exceptions ?? []).filter((r) => (decided ? r.status !== "PENDING" : r.status === "PENDING"));

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (rows.length === 0)
    return <EmptyState icon={Lock} title={decided ? "Nothing decided yet" : "No requests waiting"} description={decided ? undefined : "CSMs ask here when a client on hold needs an order."} />;

  return (
    <div className="grid gap-3">
      {rows.map((r) => (
        <div key={r.id} className="surface-panel p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.client_name}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_STYLE[r.status])}>
                  {r.status === "APPROVED" ? (r.used_order_no ? `Used on ${r.used_order_no}` : r.expired ? "Allowed, expired unused" : "Allowed") : r.status === "REJECTED" ? "Refused" : "Waiting"}
                </span>
              </div>
              <p className="mt-1 text-sm">"{r.reason}"</p>
              {r.reasons && r.reasons.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {r.reasons.slice(0, 6).map((b) => (
                    <li key={`${b.kind}-${b.order_id}-${b.invoice_no ?? ""}`}>
                      <Link to="/admin/orders/$id" params={{ id: String(b.order_id) }} className="hover:underline">
                        {blockReasonText(b)}
                      </Link>
                    </li>
                  ))}
                  {r.reasons.length > 6 && <li>and {r.reasons.length - 6} more</li>}
                </ul>
              )}
              {r.decision_note && <p className="mt-1 text-sm text-muted-foreground">Note: {r.decision_note}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {r.requester?.name ?? "A CSM"} · {format(new Date(r.created_at), "d MMM, h:mm a")}
                {r.decided_at && ` · decided by ${r.decider?.name ?? "the admin"} ${format(new Date(r.decided_at), "d MMM")}`}
              </p>
            </div>
            {r.status === "PENDING" && (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, approve: false })}>
                  <X className="mr-1.5 h-4 w-4" /> Refuse
                </Button>
                <Button size="sm" onClick={() => setDeciding({ row: r, approve: true })}>
                  <Check className="mr-1.5 h-4 w-4" /> Allow one order
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}
      <DecideDialog deciding={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function DecideDialog({ deciding, onClose }: { deciding: { row: BlockException; approve: boolean } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [openedFor, setOpenedFor] = useState<typeof deciding>(null);
  if (deciding && openedFor !== deciding) {
    setOpenedFor(deciding);
    setNote("");
  }
  const shown = deciding ?? openedFor;
  const go = useMutation({
    mutationFn: () => (shown!.approve ? approveBlockException(shown!.row.id, note.trim()) : rejectBlockException(shown!.row.id, note.trim())),
    onSuccess: () => {
      toast.success(shown!.approve ? "Allowed. The CSM has been told." : "Refused. The CSM has been told.");
      qc.invalidateQueries({ queryKey: ["order-blocks"] });
      onClose();
    },
    onError: (err) => toast.error(friendlyError(err, "Could not save")),
  });
  const needNote = !!shown && !shown.approve;
  return (
    <Dialog open={!!deciding} onOpenChange={(o) => !o && !go.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shown?.approve ? "Allow one order" : "Refuse the exception"}</DialogTitle>
          <DialogDescription>
            {shown?.approve
              ? `${shown.row.requester?.name ?? "The CSM"} may open one order for ${shown.row.client_name} within 7 days.`
              : `${shown?.row.client_name} stays on hold for ${shown?.row.requester?.name ?? "the CSM"}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="ob-note">{needNote ? "Reason" : "Note (optional)"}</Label>
          <Textarea id="ob-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-[80px]" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={go.isPending}>Cancel</Button>
          <Button disabled={go.isPending || (needNote && !note.trim())} onClick={() => go.mutate()}>
            {go.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {shown?.approve ? "Allow" : "Refuse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientSettings() {
  const [q, setQ] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["order-blocks", "clients"], queryFn: fetchClientBlockSettings });
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.clients ?? []).filter((c) => !s || `${c.name} ${c.code ?? ""}`.toLowerCase().includes(s));
  }, [data, q]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="surface-panel overflow-hidden">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="pl-8" aria-label="Search clients" />
        </div>
        <p className="text-xs text-muted-foreground">Days of 0 switch that block off. Changes save as you leave a box.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Block on</th>
              <th className="px-3 py-2">Open order, days</th>
              <th className="px-3 py-2">Unpaid bill, days</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((c) => (
              <ClientRow key={c.id} client={c} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No clients match.</p>}
      </div>
    </div>
  );
}

function ClientRow({ client }: { client: ClientBlockSettings }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(String(client.pending_block_days));
  const [payment, setPayment] = useState(String(client.payment_block_days));
  const save = useMutation({
    mutationFn: (data: Parameters<typeof updateClientBlockSettings>[1]) => updateClientBlockSettings(client.id, data),
    onSuccess: (res) => {
      qc.setQueryData<{ clients: ClientBlockSettings[] }>(["order-blocks", "clients"], (old) =>
        old ? { clients: old.clients.map((c) => (c.id === res.client.id ? res.client : c)) } : old,
      );
      toast.success(`Saved ${client.name}`);
    },
    onError: (err) => {
      setPending(String(client.pending_block_days));
      setPayment(String(client.payment_block_days));
      toast.error(friendlyError(err, "Could not save"));
    },
  });
  const commit = (field: "pending_block_days" | "payment_block_days", text: string) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > 3650) {
      toast.error("Days must be a whole number from 0 to 3650.");
      if (field === "pending_block_days") setPending(String(client.pending_block_days));
      else setPayment(String(client.payment_block_days));
      return;
    }
    if (n !== client[field]) save.mutate({ [field]: n });
  };
  return (
    <tr className="border-t">
      <td className="px-3 py-1.5">
        <div className="font-medium">{client.name}</div>
        {client.code && <div className="font-mono text-xs text-muted-foreground">{client.code}</div>}
      </td>
      <td className="px-3 py-1.5">
        <Switch checked={client.block_orders} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ block_orders: v })} aria-label={`Block orders for ${client.name}`} />
      </td>
      <td className="px-3 py-1.5">
        <Input
          type="number"
          min={0}
          className="h-8 w-24"
          value={pending}
          disabled={!client.block_orders}
          onChange={(e) => setPending(e.target.value)}
          onBlur={() => commit("pending_block_days", pending)}
          aria-label={`Open-order days for ${client.name}`}
        />
      </td>
      <td className="px-3 py-1.5">
        <Input
          type="number"
          min={0}
          className="h-8 w-24"
          value={payment}
          disabled={!client.block_orders}
          onChange={(e) => setPayment(e.target.value)}
          onBlur={() => commit("payment_block_days", payment)}
          aria-label={`Unpaid-bill days for ${client.name}`}
        />
      </td>
    </tr>
  );
}
