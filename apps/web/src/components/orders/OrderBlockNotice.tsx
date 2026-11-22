import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Clock, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkOrderBlock, requestBlockException, withdrawBlockException, blockReasonText } from "@/api/orderBlocks";
import { friendlyError } from "@/lib/friendly-error";

export const orderBlockKey = (client: string) => ["order-block", client.trim().toLowerCase()] as const;

/** Whether this client takes a new order from the signed-in CSM. */
export function useOrderBlock(client: string, enabled: boolean) {
  const name = client.trim();
  return useQuery({
    queryKey: orderBlockKey(name),
    queryFn: () => checkOrderBlock(name),
    enabled: enabled && name.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Shown on a new order once the client is picked: why the client is on hold, and a button to
 * ask the admin to allow one order. An allowed exception is shown in green.
 */
export function OrderBlockNotice({ client, enabled }: { client: string; enabled: boolean }) {
  const qc = useQueryClient();
  const { data } = useOrderBlock(client, enabled);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: orderBlockKey(client) });
  const ask = useMutation({
    mutationFn: () => requestBlockException(data!.client_name, reason.trim()),
    onSuccess: () => {
      toast.success("Sent to the admin", { description: "You'll be told when they decide." });
      setAsking(false);
      setReason("");
      refresh();
    },
    onError: (err) => toast.error(friendlyError(err, "Could not send the request")),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawBlockException(data!.pending_request!.id),
    onSuccess: refresh,
    onError: (err) => toast.error(friendlyError(err, "Could not withdraw it")),
  });

  if (!data || data.reasons.length === 0) return null;

  if (data.exception)
    return (
      <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>
          {data.client_name} is on hold, but the admin allowed you one order
          {data.exception.expires_at ? ` until ${format(new Date(data.exception.expires_at), "d MMM")}` : ""}. This order uses it.
        </span>
      </div>
    );

  if (!data.blocked) return null;

  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-destructive">New orders for {data.client_name} are on hold</p>
          <p className="text-xs text-muted-foreground">Clear these, or ask the admin to allow this one order.</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {data.reasons.slice(0, 5).map((r) => (
              <li key={`${r.kind}-${r.order_id}-${r.invoice_no ?? ""}`}>
                <Link to="/employee/orders/$id" params={{ id: String(r.order_id) }} className="underline-offset-2 hover:underline">
                  {blockReasonText(r)}
                </Link>
              </li>
            ))}
            {data.reasons.length > 5 && <li>and {data.reasons.length - 5} more</li>}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {data.pending_request ? (
              <>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Your request is with the admin.
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
                  Withdraw
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" className="h-8" onClick={() => setAsking(true)}>
                Ask the admin for an exception
              </Button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={asking} onOpenChange={(o) => !ask.isPending && setAsking(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask to allow one order</DialogTitle>
            <DialogDescription>The admin sees why {data.client_name} is on hold and decides. An allowed exception covers one order within 7 days.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="block-reason">Why can this order not wait?</Label>
            <Textarea id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="min-h-[90px]" autoFocus />
            <p className="text-xs text-muted-foreground">{reason.trim().length < 5 ? "A few words at least." : `${reason.trim().length} / 1000`}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAsking(false)} disabled={ask.isPending}>Cancel</Button>
            <Button type="button" disabled={reason.trim().length < 5 || ask.isPending} onClick={() => ask.mutate()}>
              {ask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send to admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
