import { useEffect, useMemo, useState } from "react";
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
import { checkOrderNo, currentYearCode } from "@/lib/order-number";
import { ClientCombobox } from "./AutocompleteComboboxes";

/**
 * Allot Order: an admin opens an order for a CSM, who then adds its stores and items. The number
 * field starts on the next in the series and can be changed for this one order, within the
 * order-number rule (ORD + this year's code + 0001–9999).
 */
export function StartOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [orderNo, setOrderNo] = useState("");
  const [client, setClient] = useState("");
  const [csmId, setCsmId] = useState<number | null>(null);

  const { data: series } = useQuery({
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
  const csms = useMemo(
    () => [...(csmData?.csms ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
    [csmData],
  );

  const suggested = series?.next ?? undefined;
  // The server's year code, so a computer with the wrong date can't move the year.
  const yy = series?.yearCode ?? currentYearCode();
  const usedUp = !!series && series.next === null;

  useEffect(() => {
    if (!open) return;
    setClient("");
    setCsmId(null);
    setOrderNo("");
  }, [open]);
  useEffect(() => {
    if (open && suggested) setOrderNo((n) => n || suggested);
  }, [open, suggested]);

  const check = checkOrderNo(orderNo, yy);
  const typed = orderNo.trim() !== "";
  const number = check.ok ? check.order_no : orderNo.trim().toUpperCase();

  const save = useMutation({
    mutationFn: () =>
      startOrder({
        client_name: client.trim(),
        csm_user_id: csmId!,
        // The suggestion itself goes through the sequence, so the series moves on.
        order_no: number === suggested ? null : number,
      }),
    onSuccess: (order) => {
      const csmName = csms.find((c) => c.id === csmId)?.name ?? "the CSM";
      toast.success(`Order ${order.order_no} allotted to ${csmName}`, {
        description: "They have been told to add its stores and items.",
      });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order-sequence"] });
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not allot the order"));
      qc.invalidateQueries({ queryKey: ["order-sequence"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allot Order</DialogTitle>
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
              placeholder={`ORD${yy}0123`}
              maxLength={12}
              autoCapitalize="characters"
              className="font-mono"
              aria-invalid={typed && !check.ok}
              aria-describedby="start-order-no-hint"
            />
            {/* One line of help or error, so the dialog doesn't jump as the number is typed. */}
            {typed && !check.ok ? (
              <p id="start-order-no-hint" className="text-xs text-destructive">
                {check.error}
              </p>
            ) : usedUp && !typed ? (
              <p id="start-order-no-hint" className="text-xs text-destructive">
                Order numbers for this financial year are used up (ORD{yy}9999). Contact the super admin.
              </p>
            ) : (
              <p id="start-order-no-hint" className="text-xs text-muted-foreground">
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
                {csms.map((c) => (
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
            disabled={!check.ok || !client.trim() || !csmId || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Allot Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
