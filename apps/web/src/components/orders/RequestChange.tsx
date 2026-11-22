import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  Combine,
  FilePenLine,
  GitPullRequestArrow,
  Gift,
  Loader2,
  MessageSquarePlus,
  Minus,
  Plus,
  Printer,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createOrderAdjustment } from "@/api/orders";
import {
  cancelChangeRequest,
  createChangeRequest,
  fetchCombineOptions,
  fetchOrderChangeRequests,
  requestLineRemark,
  type ChangeRequest,
} from "@/api/changeRequests";
import { friendlyError } from "@/lib/friendly-error";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

type Choice =
  | "edit"
  | "ExtraAmount"
  | "LessAmount"
  | "UnderWarranty"
  | "Reprint"
  | "Sample"
  | "FreeOfCost"
  | "combine"
  | "other";

type Group = "order" | "money" | "line" | "more";

const CHOICES: { key: Choice; label: string; hint: string; icon: typeof Plus; group: Group }[] = [
  { key: "edit", label: "Change a saved line", hint: "Rate, size, qty, line item, or remove it. Also client, store, location", icon: FilePenLine, group: "order" },
  { key: "ExtraAmount", label: "Extra Amount", hint: "Charge more on the whole order", icon: Plus, group: "money" },
  { key: "LessAmount", label: "Less Amount", hint: "Charge less on the whole order", icon: Minus, group: "money" },
  { key: "UnderWarranty", label: "Under Warranty", hint: "A line is not billed", icon: ShieldCheck, group: "line" },
  { key: "Reprint", label: "Reprint", hint: "A line is redone, not billed", icon: Printer, group: "line" },
  { key: "Sample", label: "Sample", hint: "A line is a free sample", icon: TestTube2, group: "line" },
  { key: "FreeOfCost", label: "Free of Cost", hint: "A line is given free", icon: Gift, group: "line" },
  { key: "combine", label: "Combine orders", hint: "Merge another order of this client", icon: Combine, group: "more" },
  { key: "other", label: "Something else", hint: "Tell the admin in words", icon: MessageSquarePlus, group: "more" },
];

const GROUPS: { key: Group; title: string }[] = [
  { key: "order", title: "Order details" },
  { key: "money", title: "Amount on the whole order" },
  { key: "line", title: "One line item" },
  { key: "more", title: "More" },
];

/**
 * Request Change: the CSM's one place to ask the admin for anything on an order. Saved lines
 * (rate, size, qty, line item, removal) are changed on the order form, which sends them for
 * approval; money, line remarks, combining and anything else are asked for right here. New
 * lines need no approval, so they are not here: the order page and the edit form add them.
 * On the edit form itself, onEditHere replaces the link back to the form.
 */
export function RequestChangeButton({ order, onEditHere }: { order: any; onEditHere?: () => void }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const close = () => {
    setOpen(false);
    setTimeout(() => setChoice(null), 200);
  };
  const picked = CHOICES.find((c) => c.key === choice);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Sparkles className="h-4 w-4" aria-hidden /> Request Change
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {choice && (
                <button type="button" onClick={() => setChoice(null)} className="rounded p-1 hover:bg-muted" aria-label="Back to the list">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              {picked ? picked.label : `Request Change · ${order.order_no}`}
            </DialogTitle>
            <DialogDescription>
              {picked ? "The admin approves or rejects it. You are told either way." : "What do you need changed? The admin approves it before it applies."}
            </DialogDescription>
          </DialogHeader>
          {!choice ? (
            <ChoiceGrid
              order={order}
              onPick={(c) => {
                if (c === "edit" && onEditHere) {
                  close();
                  onEditHere();
                  return;
                }
                setChoice(c);
              }}
            />
          ) : choice === "edit" ? (
            <EditRoute order={order} />
          ) : choice === "ExtraAmount" || choice === "LessAmount" ? (
            <AmountForm order={order} type={choice} onDone={close} />
          ) : choice === "combine" ? (
            <CombineForm order={order} onDone={close} />
          ) : choice === "other" ? (
            <OtherForm order={order} onDone={close} />
          ) : (
            <LineRemarkForm order={order} type={choice} onDone={close} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChoiceGrid({ onPick, order }: { onPick: (c: Choice) => void; order: any }) {
  const hasLines = (order.items?.length ?? 0) > 0;
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <section key={g.key}>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CHOICES.filter((c) => c.group === g.key).map((c) => {
              const disabled = (c.group === "line" || c.key === "edit") && !hasLines;
              return (
                <button
                  key={c.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(c.key)}
                  className="flex items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function EditRoute({ order }: { order: any }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Change what you need on the order form. Changes to saved lines, the client, store names and locations go to the admin with
        your reason. New lines, PO numbers and the order remark save at once.
      </p>
      <Link to="/employee/edit-order/$id" params={{ id: String(order.id) }} className={cn(buttonVariants(), "w-full")}>
        Open the order form
      </Link>
    </div>
  );
}

function ReasonBox({
  value,
  onChange,
  label = "Reason *",
  placeholder = "Why is this needed?",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="rc-reason">{label}</Label>
      <Textarea id="rc-reason" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={1000} />
    </div>
  );
}

function useDone(orderId: number, onDone: () => void, message: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["order"] });
    qc.invalidateQueries({ queryKey: ["change-requests", orderId] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    toast.success(message, { description: "The admin has been told." });
    onDone();
  };
}

function SendButton({ pending, label = "Send for approval" }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {label}
    </Button>
  );
}

function AmountForm({ order, type, onDone }: { order: any; type: "ExtraAmount" | "LessAmount"; onDone: () => void }) {
  const stores: any[] = order.stores ?? [];
  const [storeId, setStoreId] = useState(String(stores[0]?.id ?? ""));
  const [mode, setMode] = useState<"amount" | "newTotal">("amount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const orderTotal = Number(order.total_amount) || 0;
  const store = stores.find((s) => String(s.id) === storeId);
  const storeTotal = Number(store?.total_amount ?? orderTotal) || 0;
  const typed = Number(value) || 0;
  const figure = type === "LessAmount" && mode === "newTotal" ? Math.max(0, orderTotal - typed) : typed;
  const after = type === "ExtraAmount" ? orderTotal + figure : orderTotal - figure;
  const tooMuch = type === "LessAmount" && figure > storeTotal;
  const done = useDone(order.id, onDone, `${type === "ExtraAmount" ? "Extra" : "Less"} Amount sent for approval`);
  const send = useMutation({
    mutationFn: () =>
      createOrderAdjustment(order.id, { order_store_id: Number(storeId), type, amount: Number(figure.toFixed(2)), reason: reason.trim() }),
    onSuccess: done,
    onError: (e) => toast.error("Not sent", { description: friendlyError(e) }),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!(figure > 0)) return void toast.error("Enter the amount.");
        if (tooMuch) return void toast.error("That is more than the chosen store's total.");
        if (reason.trim().length < 3) return void toast.error("Give a reason.");
        send.mutate();
      }}
    >
      {stores.length > 1 && (
        <div className="space-y-1.5">
          <Label>Billed with store</Label>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger aria-label="Billed with store">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  S{String(s.s_no).padStart(2, "0")} {s.store_name} · {s.location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Invoices go per store, so the amount rides on one store's invoice. Store 1 unless you pick another.</p>
        </div>
      )}
      {type === "LessAmount" && (
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs" role="radiogroup" aria-label="How to enter the Less Amount">
          {(["amount", "newTotal"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("flex-1 rounded-md px-2 py-1 font-medium", mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {m === "amount" ? "Amount to take off" : "New order total"}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="rc-figure">
          {type === "ExtraAmount" ? "Extra amount (₹) *" : mode === "newTotal" ? "New order total (₹) *" : "Amount to take off (₹) *"}
        </Label>
        <Input id="rc-figure" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
      </div>
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Order total now</span>
          <span className="tabular-nums">{inr(orderTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{type === "ExtraAmount" ? "Extra Amount" : "Less Amount"}</span>
          <span className={cn("tabular-nums", type === "LessAmount" ? "text-destructive" : "text-emerald-600")}>
            {type === "ExtraAmount" ? "+" : "−"}
            {inr(figure)}
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
          <span>After approval</span>
          <span className="tabular-nums">{inr(Math.max(0, after))}</span>
        </div>
        {tooMuch && <p className="mt-1 text-xs text-destructive">More than the chosen store's total ({inr(storeTotal)}).</p>}
      </div>
      <ReasonBox value={reason} onChange={setReason} />
      <SendButton pending={send.isPending} />
    </form>
  );
}

function LineRemarkForm({ order, type, onDone }: { order: any; type: "UnderWarranty" | "Reprint" | "Sample" | "FreeOfCost"; onDone: () => void }) {
  const lines = useMemo(() => {
    const stores: any[] = order.stores ?? [];
    return (order.items ?? [])
      .filter((i: any) => !i.remarks)
      .map((i: any) => {
        const s = stores.find((x) => x.id === i.order_store_id);
        const where = s ? `S${String(s.s_no).padStart(2, "0")} · ` : "";
        return { id: i.id as number, label: `${where}${i.s_no}. ${i.media} ${i.width_inches}×${i.height_inches} ×${i.qty} — ${inr(Number(i.amount) || 0)}` };
      });
  }, [order]);
  const [itemId, setItemId] = useState(String(lines[0]?.id ?? ""));
  const [reason, setReason] = useState("");
  const label = CHOICES.find((c) => c.key === type)!.label;
  const done = useDone(order.id, onDone, `${label} sent for approval`);
  const send = useMutation({
    mutationFn: () => requestLineRemark(order.id, Number(itemId), { type, reason: reason.trim() }),
    onSuccess: done,
    onError: (e) => toast.error("Not sent", { description: friendlyError(e) }),
  });
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">Every line already has a remark or a request on it.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < 3) return void toast.error("Give a reason.");
        send.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label>Line item</Label>
        <Select value={itemId} onValueChange={setItemId}>
          <SelectTrigger aria-label="Line item">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lines.map((l: { id: number; label: string }) => (
              <SelectItem key={l.id} value={String(l.id)}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Once approved, this line is not billed.</p>
      </div>
      <ReasonBox value={reason} onChange={setReason} />
      <SendButton pending={send.isPending} />
    </form>
  );
}

function CombineForm({ order, onDone }: { order: any; onDone: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["combine-options", order.id], queryFn: () => fetchCombineOptions(order.id) });
  const options = data?.orders ?? [];
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const done = useDone(order.id, onDone, "Combine request sent");
  const send = useMutation({
    mutationFn: () => createChangeRequest(order.id, { kind: "COMBINE_ORDERS", other_order_id: Number(other), reason: reason.trim() }),
    onSuccess: done,
    onError: (e) => toast.error("Not sent", { description: friendlyError(e) }),
  });
  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />;
  if (options.length === 0) return <p className="text-sm text-muted-foreground">{order.client_name} has no other open order without an invoice.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!other) return void toast.error("Pick the order to combine.");
        if (reason.trim().length < 3) return void toast.error("Give a reason.");
        send.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label>Combine into {order.order_no}</Label>
        <Select value={other} onValueChange={setOther}>
          <SelectTrigger aria-label="Order to combine">
            <SelectValue placeholder={`Another ${order.client_name} order`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={String(o.id)}>
                {o.order_no} · {o.date ? format(new Date(o.date), "dd MMM") : ""} · {o._count.stores} store{o._count.stores === 1 ? "" : "s"},{" "}
                {o._count.items} line{o._count.items === 1 ? "" : "s"} · {o.creator_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Its stores, lines, field work and payment requests move here. That number closes as merged and is never reused.
        </p>
      </div>
      <ReasonBox value={reason} onChange={setReason} />
      <SendButton pending={send.isPending} />
    </form>
  );
}

function OtherForm({ order, onDone }: { order: any; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const done = useDone(order.id, onDone, "Request sent");
  const send = useMutation({
    mutationFn: () => createChangeRequest(order.id, { kind: "OTHER", reason: reason.trim() }),
    onSuccess: done,
    onError: (e) => toast.error("Not sent", { description: friendlyError(e) }),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < 3) return void toast.error("Say what you need.");
        send.mutate();
      }}
    >
      <ReasonBox value={reason} onChange={setReason} label="What do you need? *" placeholder="Describe the change and why" />
      <SendButton pending={send.isPending} label="Send to admin" />
    </form>
  );
}

export const CHANGE_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Requested: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-destructive/10 text-destructive",
  Rejected: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export const CHANGE_KIND_LABEL: Record<string, string> = {
  LINE_EDIT: "Order change",
  COMBINE_ORDERS: "Combine orders",
  RATE_CHANGE: "Rate change",
  OTHER: "Other request",
};

/** The order's Request Change history: what was asked, and what the admin decided. */
export function ChangeRequestsPanel({ orderId, currentUserId }: { orderId: number; currentUserId?: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["change-requests", orderId], queryFn: () => fetchOrderChangeRequests(orderId) });
  const withdraw = useMutation({
    mutationFn: (id: number) => cancelChangeRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["change-requests", orderId] });
      toast.success("Request withdrawn");
    },
    onError: (e) => toast.error("Not withdrawn", { description: friendlyError(e) }),
  });
  const requests: ChangeRequest[] = data?.requests ?? [];
  if (requests.length === 0) return null;
  return (
    <section className="surface-panel p-4 sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <GitPullRequestArrow className="h-4 w-4" aria-hidden /> Change requests
      </h2>
      <ul className="divide-y rounded-lg border">
        {requests.map((r) => (
          <li key={r.id} className="grid gap-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{CHANGE_KIND_LABEL[r.kind] ?? r.kind}</span>
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", CHANGE_STATUS_STYLE[r.status])}>{r.status.toLowerCase()}</span>
              <span className="text-xs text-muted-foreground">
                {r.requester?.name} · {format(new Date(r.created_at), "dd MMM, h:mm a")}
              </span>
              {r.status === "PENDING" && r.requester?.id === currentUserId && (
                <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => withdraw.mutate(r.id)} disabled={withdraw.isPending}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" /> Withdraw
                </Button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-xs">{r.summary}</p>
            {r.kind !== "OTHER" && <p className="text-xs text-muted-foreground">Reason: {r.reason}</p>}
            {r.decision_note && (
              <p className="text-xs">
                <span className="font-medium">{r.decider?.name ?? "Admin"}:</span> {r.decision_note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
