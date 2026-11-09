import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeIndianRupee, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { inr } from "@/lib/format";
import { remarkLabel } from "@/lib/constants";
import { createOrderAdjustment, decideOrderAdjustment, requestItemAdjustment } from "@/api/orders";
import type { OrderAdjustment, OrderItem } from "@sb-oms/shared-types";

type AmountType = "ExtraAmount" | "LessAmount";
type LessMode = "discount" | "newAmount";

const errText = (err: any) => err?.response?.data?.message || err?.message || "Something went wrong";

/**
 * The figure for an Extra / Less Amount. A Less Amount can be typed as the discount or as the
 * amount after it; `base` is what it comes off, so either way the result is the discount.
 */
export function AdjustmentFigure({
  type, base, value, onChange, mode, onModeChange, idPrefix,
}: {
  type: AmountType;
  base: number;
  value: string;
  onChange: (v: string) => void;
  mode: LessMode;
  onModeChange: (m: LessMode) => void;
  idPrefix: string;
}) {
  const typed = Number(value) || 0;
  const discount = type === "LessAmount" && mode === "newAmount" ? Math.max(0, base - typed) : typed;
  const after = type === "ExtraAmount" ? base + typed : Math.max(0, base - discount);
  return (
    <div className="space-y-2">
      {type === "LessAmount" && (
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs" role="radiogroup" aria-label="How to enter the Less Amount">
          {(["discount", "newAmount"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => onModeChange(m)}
              className={`flex-1 rounded-md px-2 py-1 font-medium ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {m === "discount" ? "Discount" : "New amount"}
            </button>
          ))}
        </div>
      )}
      <Label htmlFor={`${idPrefix}-figure`}>
        {type === "ExtraAmount" ? "Extra amount (₹) *" : mode === "newAmount" ? "New amount (₹) *" : "Discount (₹) *"}
      </Label>
      <Input
        id={`${idPrefix}-figure`}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder="0.00"
      />
      <p className="text-xs text-muted-foreground tabular-nums">
        {inr(base)} {type === "ExtraAmount" ? "+" : "−"} {inr(type === "ExtraAmount" ? typed : discount)} = <strong>{inr(after)}</strong>
      </p>
    </div>
  );
}

/** The rupee figure an AdjustmentFigure stands for. */
export const figureOf = (type: AmountType, base: number, value: string, mode: LessMode) => {
  const typed = Number(value) || 0;
  return type === "LessAmount" && mode === "newAmount" ? Math.max(0, base - typed) : typed;
};

/** CSM: ask an admin for an Extra / Less Amount on one saved line. */
export function RequestLineAdjustmentDialog({ orderId, item }: { orderId: number; item: OrderItem }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AmountType>("ExtraAmount");
  const [mode, setMode] = useState<LessMode>("discount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const base = Number(item.amount) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = figureOf(type, base, value, mode);
    if (!(amount > 0)) return toast.error("Enter the amount.");
    if (type === "LessAmount" && amount > base) return toast.error("A Less Amount cannot be more than the line.");
    if (!reason.trim()) return toast.error("A reason is required.");
    setBusy(true);
    try {
      await requestItemAdjustment(orderId, item.id!, { type, amount: Number(amount.toFixed(2)), reason: reason.trim() });
      toast.success("Request sent", { description: "An admin will set the final figure." });
      qc.invalidateQueries({ queryKey: ["order", orderId.toString()] });
      setOpen(false);
    } catch (err) {
      toast.error("Couldn't send the request", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setValue(""); setReason(""); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="h-7 w-7" title="Ask for an amount change">
          <BadgeIndianRupee className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask for an amount change</DialogTitle>
          <DialogDescription>
            Item #{item.s_no} · {item.media}. An admin approves it and can change the figure. The line is billed at {inr(base)} until then.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Change</Label>
            <Select value={type} onValueChange={(v) => setType(v as AmountType)}>
              <SelectTrigger aria-label="Change"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ExtraAmount">Extra Amount</SelectItem>
                <SelectItem value="LessAmount">Less Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AdjustmentFigure type={type} base={base} value={value} onChange={setValue} mode={mode} onModeChange={setMode} idPrefix={`req-${item.id}`} />
          <div className="space-y-2">
            <Label htmlFor={`req-${item.id}-reason`}>Reason *</Label>
            <Textarea id={`req-${item.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the amount should change" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>Send to admin</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_STYLE: Record<string, string> = {
  Requested: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Approved: "bg-success/15 text-success",
  Rejected: "bg-muted text-muted-foreground line-through",
};

/**
 * Whole-order Extra / Less Amounts. Each sits on one store, because that store's invoice is
 * what carries it. The order's CSM requests; an admin adds directly, or approves / rejects.
 */
export function OrderAdjustmentsPanel({
  order, userRole, isCreator,
}: {
  order: any;
  userRole?: string;
  isCreator: boolean;
}) {
  const adjustments: OrderAdjustment[] = order.adjustments ?? [];
  const stores: any[] = order.stores ?? [];
  const isAdmin = userRole === "ADMIN";
  const open = order.status !== "Completed";
  const canAdd = open && stores.length > 0 && (isAdmin || (userRole === "CSM" && isCreator));
  if (adjustments.length === 0 && !canAdd) return null;

  const storeName = (id: number) => stores.find((s) => s.id === id)?.store_name ?? `Store #${id}`;

  return (
    <div className="border-t px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Whole-order amount changes</h3>
          <p className="text-xs text-muted-foreground">Extra or Less Amount on the whole order. Each is billed on the chosen store's invoice.</p>
        </div>
        {canAdd && <AddOrderAdjustmentDialog order={order} isAdmin={isAdmin} />}
      </div>
      {adjustments.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {adjustments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{remarkLabel(a.type)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[a.status] ?? ""}`}>{a.status}</span>
                  <span className="text-xs text-muted-foreground">{storeName(a.order_store_id)}</span>
                </div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap">{a.reason}</div>
                <div className="text-[11px] text-muted-foreground">
                  {a.requester?.name ? `By ${a.requester.name}` : ""}
                  {a.created_at ? ` · ${format(new Date(a.created_at), "MMM d, yyyy")}` : ""}
                  {a.requested_amount != null && Number(a.requested_amount) !== Number(a.amount) && ` · asked ${inr(Number(a.requested_amount))}`}
                  {a.decider?.name && a.status !== "Requested" && ` · ${a.status.toLowerCase()} by ${a.decider.name}`}
                  {a.decision_note && ` · ${a.decision_note}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-semibold tabular-nums ${a.status === "Rejected" ? "text-muted-foreground line-through" : ""}`}>
                  {a.type === "ExtraAmount" ? "+" : "−"}{inr(Number(a.amount))}
                </span>
                {isAdmin && open && a.status !== "Rejected" && <DecideAdjustmentDialog orderId={order.id} adjustment={a} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddOrderAdjustmentDialog({ order, isAdmin }: { order: any; isAdmin: boolean }) {
  const qc = useQueryClient();
  const stores: any[] = order.stores ?? [];
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState<string>(String(stores[0]?.id ?? ""));
  const [type, setType] = useState<AmountType>("ExtraAmount");
  const [mode, setMode] = useState<LessMode>("discount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const store = stores.find((s) => String(s.id) === storeId);
  const base = Number(store?.total_amount ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = figureOf(type, base, value, mode);
    if (!store) return toast.error("Pick a store.");
    if (!(amount > 0)) return toast.error("Enter the amount.");
    if (type === "LessAmount" && amount > base) return toast.error("A Less Amount cannot be more than the store's total.");
    if (!reason.trim()) return toast.error("A reason is required.");
    setBusy(true);
    try {
      await createOrderAdjustment(order.id, { order_store_id: store.id, type, amount: Number(amount.toFixed(2)), reason: reason.trim() });
      toast.success(isAdmin ? "Amount change applied" : "Request sent", {
        description: isAdmin ? undefined : "An admin will set the final figure.",
      });
      qc.invalidateQueries({ queryKey: ["order", order.id.toString()] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setOpen(false);
    } catch (err) {
      toast.error(isAdmin ? "Couldn't apply the change" : "Couldn't send the request", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setValue(""); setReason(""); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-lg">
          <BadgeIndianRupee className="mr-1 h-3.5 w-3.5" /> {isAdmin ? "Add amount change" : "Ask for amount change"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isAdmin ? "Whole-order amount change" : "Ask for a whole-order amount change"}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Applied now. If the store is already invoiced, the order goes to Pending until Accounts corrects the invoice."
              : "An admin approves it and can change the figure."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Change</Label>
              <Select value={type} onValueChange={(v) => setType(v as AmountType)}>
                <SelectTrigger aria-label="Change"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ExtraAmount">Extra Amount</SelectItem>
                  <SelectItem value="LessAmount">Less Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Billed on</Label>
              <Select value={storeId} onValueChange={setStoreId} disabled={stores.length <= 1}>
                <SelectTrigger aria-label="Billed on store"><SelectValue placeholder="Store" /></SelectTrigger>
                <SelectContent>
                  {stores.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.store_name} ({s.location})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AdjustmentFigure type={type} base={base} value={value} onChange={setValue} mode={mode} onModeChange={setMode} idPrefix="order-adj" />
          <div className="space-y-2">
            <Label htmlFor="order-adj-reason">Reason *</Label>
            <Textarea id="order-adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the amount changes" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{isAdmin ? "Apply" : "Send to admin"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideAdjustmentDialog({ orderId, adjustment }: { orderId: number; adjustment: OrderAdjustment }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(adjustment.amount));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isRequest = adjustment.status === "Requested";

  const decide = async (action: "approve" | "reject") => {
    const amount = Number(value);
    if (action === "approve" && !(amount > 0)) return toast.error("Enter the amount.");
    if (action === "reject" && !note.trim()) return toast.error("Give a reason for rejecting.");
    setBusy(true);
    try {
      await decideOrderAdjustment(orderId, adjustment.id, { action, amount: action === "approve" ? amount : undefined, note: note.trim() || null });
      toast.success(action === "approve" ? "Approved" : isRequest ? "Rejected" : "Removed from the bill");
      qc.invalidateQueries({ queryKey: ["order", orderId.toString()] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setOpen(false);
    } catch (err) {
      toast.error("Couldn't save the decision", { description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setValue(String(adjustment.amount)); setNote(""); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={isRequest ? "default" : "ghost"} className="h-7 rounded-lg text-xs">
          {isRequest ? "Review" : "Change"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isRequest ? `Review ${remarkLabel(adjustment.type)} request` : `Change ${remarkLabel(adjustment.type)}`}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">{adjustment.reason}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor={`decide-${adjustment.id}-amount`}>Amount (₹)</Label>
            <Input id={`decide-${adjustment.id}-amount`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
            {adjustment.requested_amount != null && (
              <p className="text-xs text-muted-foreground">The CSM asked for {inr(Number(adjustment.requested_amount))}.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`decide-${adjustment.id}-note`}>Note {isRequest ? "(required to reject)" : "(required to remove)"}</Label>
            <Textarea id={`decide-${adjustment.id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sent to the CSM" />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => decide("reject")}>
            <X className="mr-1 h-3.5 w-3.5" /> {isRequest ? "Reject" : "Remove"}
          </Button>
          <Button type="button" disabled={busy} onClick={() => decide("approve")}>
            <Check className="mr-1 h-3.5 w-3.5" /> {isRequest ? "Approve" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
