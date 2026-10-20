import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/api/allocation";
import {
  CATEGORY_LABELS,
  PAYMENT_STATUS_LABELS,
  createPaymentRequest,
  fetchPaymentOrderOptions,
  type PaymentCategory,
  type PaymentOrderOption,
  type PaymentRequestInput,
  type PaymentStatus,
} from "@/api/payments";

/** Shared pieces of the payment-request pages: status badge, request form, new-request dialog. */

const statusStyles: Record<PaymentStatus, string> = {
  ADMIN_REVIEW: "bg-info/15 text-info border-info/30",
  CCM_REVIEW: "bg-info/15 text-info border-info/30",
  INFO_REQUESTED: "bg-warning/15 text-warning-foreground border-warning/30",
  PAYMENT_PENDING: "bg-primary/15 text-primary border-primary/30",
  PAID: "bg-success/15 text-success border-success/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
};

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

export const UPI_PATTERN = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;
const NONE = "__none__";

/** The editable details of a request, as typed. */
export interface RequestDraft {
  amount: string;
  upi_id: string;
  category: string;
  purpose: string;
  remarks: string;
}

export const draftFrom = (r?: Partial<PaymentRequestInput> | null, upi = ""): RequestDraft => ({
  amount: r?.amount != null ? String(r.amount) : "",
  upi_id: r?.upi_id ?? upi,
  category: r?.category ?? NONE,
  purpose: r?.purpose ?? "",
  remarks: r?.remarks ?? "",
});

/** Check a draft; returns the API body or a message to show. */
export function readDraft(d: RequestDraft): { input: PaymentRequestInput } | { error: string } {
  const amount = Number(d.amount);
  if (!d.amount.trim() || !Number.isFinite(amount) || amount <= 0)
    return { error: "Enter an amount above zero." };
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
    return { error: "Use at most 2 decimals in the amount." };
  const upi = d.upi_id.trim().toLowerCase();
  if (!UPI_PATTERN.test(upi)) return { error: "Enter a UPI ID like name@bank." };
  if (d.purpose.trim().length < 3) return { error: "Say what the money is for." };
  return {
    input: {
      amount,
      upi_id: upi,
      category: d.category === NONE ? null : (d.category as PaymentCategory),
      purpose: d.purpose.trim(),
      remarks: d.remarks.trim() || null,
    },
  };
}

/** Amount, UPI ID, category, purpose, remarks: used to raise and to correct a request. */
export function RequestFields({
  draft,
  onChange,
}: {
  draft: RequestDraft;
  onChange: (d: RequestDraft) => void;
}) {
  const set = (patch: Partial<RequestDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pr-amount">Amount (₹)</Label>
          <Input
            id="pr-amount"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })}
            placeholder="0"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pr-upi">Your UPI ID</Label>
          <Input
            id="pr-upi"
            autoCapitalize="none"
            autoCorrect="off"
            value={draft.upi_id}
            onChange={(e) => set({ upi_id: e.target.value.trim() })}
            placeholder="name@bank"
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Category</Label>
        <Select value={draft.category} onValueChange={(v) => set({ category: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {(Object.keys(CATEGORY_LABELS) as PaymentCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pr-purpose">What is it for?</Label>
        <Input
          id="pr-purpose"
          value={draft.purpose}
          maxLength={300}
          onChange={(e) => set({ purpose: e.target.value })}
          placeholder="Auto fare to site, glue and tape…"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pr-remarks">Remarks (optional)</Label>
        <Textarea
          id="pr-remarks"
          rows={2}
          maxLength={1000}
          value={draft.remarks}
          onChange={(e) => set({ remarks: e.target.value })}
        />
      </div>
    </>
  );
}

/** Raise a request on one of the requester's orders. */
export function NewPaymentRequestDialog({
  open,
  onClose,
  lastUpi,
}: {
  open: boolean;
  onClose: () => void;
  /** The UPI ID from this person's last request, to save retyping it. */
  lastUpi?: string;
}) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<PaymentOrderOption | null>(null);
  const [jobId, setJobId] = useState(NONE);
  const [draft, setDraft] = useState<RequestDraft>(draftFrom(null));
  const [bill, setBill] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOrder(null);
    setJobId(NONE);
    setDraft(draftFrom(null, lastUpi ?? ""));
    setBill(null);
    setError(null);
    // One key per form: a double click or a retry after a timeout cannot create two.
    setKey(crypto.randomUUID());
  }, [open, lastUpi]);

  const save = useMutation({
    mutationFn: createPaymentRequest,
    onSuccess: (res) => {
      toast.success(`${res.request.request_no} sent for review`);
      if (res.warning) toast.warning(res.warning);
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err, "Could not send the request")),
  });

  const submit = () => {
    setError(null);
    if (!order) return setError("Pick the order this is for.");
    if (!order.eligibility.eligible) return setError(order.eligibility.reason);
    const read = readDraft(draft);
    if ("error" in read) return setError(read.error);
    if (bill === null) return setError("Answer “Bill details required?”.");
    save.mutate({
      ...read.input,
      order_id: order.id,
      work_job_id: jobId === NONE ? null : Number(jobId),
      bill_details_required: bill,
      idempotency_key: key,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New payment request</DialogTitle>
          <DialogDescription>
            The company pays this to your UPI ID once it is approved. Orders open for requests once
            production is finished, and close when billing starts.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Order</Label>
            <PaymentOrderPicker
              value={order}
              onChange={(o) => {
                setOrder(o);
                setJobId(o.jobs.length === 1 ? String(o.jobs[0].id) : NONE);
              }}
            />
            {order && !order.eligibility.eligible && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {order.eligibility.reason}
              </p>
            )}
          </div>

          {order && order.jobs.length > 0 && (
            <div className="grid gap-1.5">
              <Label>Field job (optional)</Label>
              <Select value={jobId} onValueChange={setJobId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not for a particular job</SelectItem>
                  {order.jobs.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      {j.job_no} · {j.start_date} · {j.work_details.slice(0, 40)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <RequestFields draft={draft} onChange={setDraft} />

          <div className="grid gap-1.5">
            <Label>Bill details required?</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  v: true,
                  label: "Yes, I have a bill",
                  hint: "Goes straight to Cost Control. Bill must be attached before it closes.",
                },
                {
                  v: false,
                  label: "No bill",
                  hint: "The Admin approves first, then Cost Control.",
                },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setBill(o.v)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    bill === o.v ? "border-primary bg-primary/10" : "hover:bg-muted/60",
                  )}
                  aria-pressed={bill === o.v}
                >
                  <div className="text-sm font-medium">{o.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentOrderPicker({
  value,
  onChange,
}: {
  value: PaymentOrderOption | null;
  onChange: (o: PaymentOrderOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["payment-requests", "order-options", debounced],
    queryFn: () => fetchPaymentOrderOptions(debounced),
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="h-auto min-h-10 w-full justify-between rounded-xl py-2 text-left font-normal"
        >
          {value ? (
            <span className="min-w-0 truncate">
              <span className="font-mono font-semibold">{value.order_no}</span> ·{" "}
              {value.client_name}
            </span>
          ) : (
            <span className="text-muted-foreground">Search your orders</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Order no or client" />
          <CommandList>
            {isFetching && !data ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Searching…</div>
            ) : (
              <CommandEmpty>No orders found.</CommandEmpty>
            )}
            <CommandGroup>
              {(data?.orders ?? []).map((o) => (
                <CommandItem
                  key={o.id}
                  value={String(o.id)}
                  onSelect={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                  className={cn(!o.eligibility.eligible && "opacity-60")}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value?.id === o.id ? "opacity-100" : "opacity-0")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="font-mono font-semibold">{o.order_no}</span> ·{" "}
                      {o.client_name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {o.eligibility.eligible ? "Open for requests" : o.eligibility.reason}
                    </div>
                  </div>
                  {!o.eligibility.eligible && <Lock className="ml-2 h-3.5 w-3.5 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
