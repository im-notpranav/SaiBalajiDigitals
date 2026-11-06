import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage, fetchCsmOptions } from "@/api/allocation";
import { fetchNextOrderNumber, startOrder } from "@/api/orders";
import { ClientCombobox } from "./AutocompleteComboboxes";

/**
 * An admin opens an order for a CSM, who then adds its stores and items. The number field starts
 * on the next in the series and can be changed for this one order.
 */
export function StartOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [orderNo, setOrderNo] = useState("");
  const [client, setClient] = useState("");
  const [csmId, setCsmId] = useState<number | null>(null);

  const { data: suggested } = useQuery({
    queryKey: ["order-sequence", "next"],
    queryFn: fetchNextOrderNumber,
    enabled: open,
    staleTime: 0,
  });
  const { data: csmData } = useQuery({
    queryKey: ["work-jobs", "csm-options"],
    queryFn: fetchCsmOptions,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setClient("");
    setCsmId(null);
    setOrderNo("");
  }, [open]);
  useEffect(() => {
    if (open && suggested) setOrderNo((n) => n || suggested);
  }, [open, suggested]);

  const number = orderNo.trim().toUpperCase();
  const numberValid = /^ORD\d{1,16}$/.test(number);

  const save = useMutation({
    mutationFn: () =>
      startOrder({
        client_name: client.trim(),
        csm_user_id: csmId!,
        // The suggestion itself goes through the sequence, so the series moves on.
        order_no: number === suggested ? null : number,
      }),
    onSuccess: (order) => {
      toast.success(`Order ${order.order_no} started`, {
        description: "The CSM has been told to add its stores and items.",
      });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-sequence"] });
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not start the order"));
      qc.invalidateQueries({ queryKey: ["order-sequence"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            Give it a number, a client and a CSM. The CSM adds the stores and items.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="start-order-no">Order number</Label>
            <Input
              id="start-order-no"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              className="font-mono"
              aria-invalid={!!number && !numberValid}
            />
            {number && !numberValid ? (
              <p className="text-xs text-destructive">Use ORD followed by digits, like ORD260123.</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The next in the series is filled in. Change the series itself under Settings.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="start-order-client">Client</Label>
            <ClientCombobox id="start-order-client" value={client} onChange={setClient} />
          </div>
          <div className="grid gap-2">
            <Label>CSM</Label>
            <Select value={csmId ? String(csmId) : undefined} onValueChange={(v) => setCsmId(Number(v))}>
              <SelectTrigger aria-label="CSM">
                <SelectValue placeholder="Pick the CSM" />
              </SelectTrigger>
              <SelectContent>
                {(csmData?.csms ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!numberValid || !client.trim() || !csmId || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
