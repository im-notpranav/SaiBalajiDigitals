import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Cog, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CsmTag } from "@/components/orders/CsmTag";
import { ageDays, ageTone, fetchMyMachineQueue, lineSize, rejectLine, startLine, type MachineLine } from "@/api/machines";
import { friendlyError } from "@/lib/friendly-error";
import { cn } from "@/lib/utils";

/**
 * The operator's machine queue: lines waiting on their machine. Starting one takes it (it joins
 * "my queue"); rejecting sends it to the Production Manager with the reason.
 */
export function MachineQueuePanel() {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<MachineLine | null>(null);
  const [reason, setReason] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["machine-queue"], queryFn: fetchMyMachineQueue, refetchInterval: 30_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["machine-queue"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["production"] });
  };
  const start = useMutation({
    mutationFn: (id: number) => startLine(id),
    onSuccess: () => {
      refresh();
      toast.success("Line is yours", { description: "It is now in your queue. Mark it finished there." });
    },
    onError: (e) => {
      refresh();
      toast.error("Not started", { description: friendlyError(e) });
    },
  });
  const reject = useMutation({
    mutationFn: (v: { id: number; reason: string }) => rejectLine(v.id, v.reason),
    onSuccess: () => {
      refresh();
      setRejecting(null);
      toast.success("Sent to the Production Manager");
    },
    onError: (e) => toast.error("Not sent", { description: friendlyError(e) }),
  });

  if (isLoading) return null;
  if (!data?.machine) {
    return (
      <section className="surface-panel mb-6 flex items-center gap-3 p-4 text-sm text-muted-foreground">
        <Cog className="h-5 w-5" aria-hidden /> You have no machine yet. The Production Manager gives each operator a machine; lines for it then wait here.
      </section>
    );
  }
  const lines = data.lines;
  return (
    <section className="surface-panel mb-6 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Cog className="h-4 w-4 text-primary" aria-hidden /> {data.machine.name} queue
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{lines.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">Waiting for any {data.machine.name} operator. The first to start takes it.</p>
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting on {data.machine.name}.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {lines.map((l) => {
            const days = ageDays(l.order.date);
            return (
              <li key={l.id} className="grid gap-2 rounded-xl border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-sm font-semibold">{l.order.order_no}</span>
                      <CsmTag id={l.order.created_by} name={l.order.creator_name} compact />
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={l.order.client_name}>
                      {l.order.client_name}
                      {l.orderStore ? ` · ${l.orderStore.store_name}` : ""}
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", ageTone(days))}>{days}d</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium">{l.media}</span>{" "}
                  <span className="tabular-nums text-muted-foreground">
                    {lineSize(l)} · {Number(l.total_sft).toFixed(2)} sft
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" disabled={start.isPending} onClick={() => start.mutate(l.id)}>
                    {start.isPending && start.variables === l.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
                    Start
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReason("");
                      setRejecting(l);
                    }}
                  >
                    <Ban className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.media} on {rejecting?.order.order_no}?</DialogTitle>
            <DialogDescription>It leaves the {data.machine.name} queue and goes to the Production Manager.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-line-reason">Reason *</Label>
            <Textarea id="reject-line-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Needs the UV machine" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending || reason.trim().length < 3}
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason: reason.trim() })}
            >
              {reject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
