import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveChangeRequest, rejectChangeRequest, type QueueRow } from "@/api/changeRequests";
import { decideOrderAdjustment, setItemLossRemark } from "@/api/orders";
import { friendlyError } from "@/lib/friendly-error";
import { inr } from "@/lib/format";

/**
 * Approve or reject one row of the Change Requests queue, whatever it is: a change request,
 * a whole-order Extra / Less Amount, or a line remark. Used by the queue and the compare page.
 */
export function DecideDialog({
  row,
  action,
  onClose,
  onDecided,
}: {
  row: QueueRow;
  action: "approve" | "reject";
  onClose: () => void;
  onDecided?: () => void;
}) {
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
      onDecided?.();
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
            <Textarea id="decide-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus={!approve} />
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
