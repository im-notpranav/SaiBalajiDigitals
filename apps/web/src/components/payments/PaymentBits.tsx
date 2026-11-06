import { useEffect, useRef, useState } from "react";
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
  FILE_ACCEPT,
  createPaymentRequest,
  uploadPaymentFile,
  type AttachmentKind,
  fetchPaymentOrderOptions,
  type PaymentCategory,
  type PaymentOrderOption,
  type PaymentRequestInput,
  type PaymentStatus,
  type UpiMethod,
} from "@/api/payments";
import { formatJobDates } from "@/api/allocation";

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

/** The same checks as the API (normaliseUpi in utils/validators.ts). */
export const UPI_PATTERN = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/;
const UPI_MOBILE_PATTERN = /^[6-9]\d{9}$/;
const NONE = "__none__";

/** "+91 98765 43210", "098765-43210" → "9876543210". */
const mobileDigits = (raw: string) =>
  raw.replace(/[\s()-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");

/** What is wrong with this UPI ID or mobile number, or null when it is fine. */
export function upiProblem(method: UpiMethod, raw: string): string | null {
  if (method === "MOBILE") {
    return UPI_MOBILE_PATTERN.test(mobileDigits(raw))
      ? null
      : "Enter the 10-digit mobile number linked to UPI, e.g. 98765 43210.";
  }
  return UPI_PATTERN.test(raw.trim().toLowerCase()) ? null : "Enter a UPI ID like name@bank.";
}

/** "name@bank", or "98765 43210" for a UPI-linked mobile number. */
export const payeeText = (p: { upi_method: UpiMethod; upi_id: string }) =>
  p.upi_method === "MOBILE" && p.upi_id.length === 10
    ? `${p.upi_id.slice(0, 5)} ${p.upi_id.slice(5)}`
    : p.upi_id;

export const UPI_METHOD_LABELS: Record<UpiMethod, string> = {
  UPI_ID: "UPI ID",
  MOBILE: "UPI mobile number",
};

/**
 * The editable details of a request, as typed. The UPI ID and the mobile number are kept
 * apart so switching between them never loses what was typed in the other.
 */
export interface RequestDraft {
  amount: string;
  upi_method: UpiMethod;
  upi_id: string;
  upi_mobile: string;
  category: string;
  purpose: string;
  remarks: string;
}

type Payee = { upi_method: UpiMethod; upi_id: string };

/** A draft from an existing request, or a blank one that reuses the last payee. */
export const draftFrom = (
  r?: Partial<PaymentRequestInput> | null,
  lastPayee?: Payee | null,
): RequestDraft => {
  const payee: Payee | null | undefined = r?.upi_id
    ? { upi_method: r.upi_method ?? "UPI_ID", upi_id: r.upi_id }
    : lastPayee;
  const method = payee?.upi_method ?? "UPI_ID";
  return {
    amount: r?.amount != null ? String(r.amount) : "",
    upi_method: method,
    upi_id: method === "UPI_ID" ? (payee?.upi_id ?? "") : "",
    upi_mobile: method === "MOBILE" ? (payee?.upi_id ?? "") : "",
    category: r?.category ?? NONE,
    purpose: r?.purpose ?? "",
    remarks: r?.remarks ?? "",
  };
};

/** Check a draft; returns the API body or a message to show. */
export function readDraft(d: RequestDraft): { input: PaymentRequestInput } | { error: string } {
  const amount = Number(d.amount);
  if (!d.amount.trim() || !Number.isFinite(amount) || amount <= 0)
    return { error: "Enter an amount above zero." };
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
    return { error: "Use at most 2 decimals in the amount." };
  const raw = d.upi_method === "MOBILE" ? d.upi_mobile : d.upi_id;
  const problem = upiProblem(d.upi_method, raw);
  if (problem) return { error: problem };
  if (d.purpose.trim().length < 3) return { error: "Say what the money is for." };
  return {
    input: {
      amount,
      upi_method: d.upi_method,
      upi_id: d.upi_method === "MOBILE" ? mobileDigits(raw) : raw.trim().toLowerCase(),
      category: d.category === NONE ? null : (d.category as PaymentCategory),
      purpose: d.purpose.trim(),
      remarks: d.remarks.trim() || null,
    },
  };
}

/** Amount, where to pay, category, purpose, remarks: used to raise and to correct a request. */
export function RequestFields({
  draft,
  onChange,
}: {
  draft: RequestDraft;
  onChange: (d: RequestDraft) => void;
}) {
  const set = (patch: Partial<RequestDraft>) => onChange({ ...draft, ...patch });
  const [touched, setTouched] = useState(false);
  const mobile = draft.upi_method === "MOBILE";
  const value = mobile ? draft.upi_mobile : draft.upi_id;
  const problem = touched && value.trim() ? upiProblem(draft.upi_method, value) : null;
  return (
    <>
      <div className="grid gap-1.5 sm:max-w-[12rem]">
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
        <Label id="pr-payto-label">Pay to</Label>
        <div
          role="radiogroup"
          aria-labelledby="pr-payto-label"
          className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1"
        >
          {(["UPI_ID", "MOBILE"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={draft.upi_method === m}
              onClick={() => {
                set({ upi_method: m });
                setTouched(false);
              }}
              className={cn(
                "min-h-9 rounded-lg px-2 text-sm font-medium transition-colors",
                draft.upi_method === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {UPI_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        {mobile ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-lg border bg-muted/40 px-2.5 py-2 text-sm text-muted-foreground">
              +91
            </span>
            <Input
              id="pr-upi"
              aria-label="UPI mobile number"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={16}
              value={draft.upi_mobile}
              onChange={(e) => set({ upi_mobile: e.target.value.replace(/[^\d\s+()-]/g, "") })}
              onBlur={() => setTouched(true)}
              aria-invalid={!!problem}
              placeholder="98765 43210"
            />
          </div>
        ) : (
          <Input
            id="pr-upi"
            aria-label="UPI ID"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={draft.upi_id}
            onChange={(e) => set({ upi_id: e.target.value.trim() })}
            onBlur={() => setTouched(true)}
            aria-invalid={!!problem}
            placeholder="name@bank"
          />
        )}
        <p className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")}>
          {problem ??
            (mobile
              ? "The mobile number your UPI app is registered on."
              : "Shown in your UPI app, e.g. ravi.kumar@okaxis.")}
        </p>
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
  lastPayee,
}: {
  open: boolean;
  onClose: () => void;
  /** Where this person's last request was paid, to save retyping it. */
  lastPayee?: { upi_method: UpiMethod; upi_id: string } | null;
}) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<PaymentOrderOption | null>(null);
  const [jobId, setJobId] = useState(NONE);
  const [draft, setDraft] = useState<RequestDraft>(draftFrom(null));
  const [bill, setBill] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<{ kind: AttachmentKind; file: File }[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setUploading(null);
    setOrder(null);
    setJobId(NONE);
    setDraft(draftFrom(null, lastPayee));
    setBill(null);
    setError(null);
    // One key per form: a double click or a retry after a timeout cannot create two.
    setKey(crypto.randomUUID());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const save = useMutation({
    mutationFn: createPaymentRequest,
    onSuccess: async (res) => {
      // The request exists now; files go up one by one. One failing does not undo it:
      // the requester can add it again from the request.
      const failed: string[] = [];
      for (const f of files) {
        setUploading(f.file.name);
        try {
          await uploadPaymentFile(res.request.id, f.kind, f.file);
        } catch (err) {
          const why =
            err instanceof Error && !("response" in err)
              ? err.message
              : apiErrorMessage(err, "could not be added");
          failed.push(`${f.file.name}: ${why}`);
        }
      }
      setUploading(null);
      toast.success(`Request on ${res.request.order.order_no} sent for review`);
      if (res.warning) toast.warning(res.warning);
      if (failed.length)
        toast.error(
          `Some files were not added. Open the request to try again. ${failed.join("; ")}`,
        );
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
    if (bill === null) return setError("Choose whether you need to submit details.");
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
            The company pays this to your UPI ID or UPI mobile number once it is approved. Orders
            open for requests once production is finished, and close when billing starts.
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
                      {formatJobDates(j.start_date, j.start_date)} · {j.work_details.slice(0, 40)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <RequestFields draft={draft} onChange={setDraft} />

          <div className="grid gap-1.5">
            <Label>Bill details</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  v: true,
                  label: "Need to submit details",
                  hint: "Goes to Cost Control. The bill must be attached before it is approved. Large amounts go to the Admin first.",
                },
                {
                  v: false,
                  label: "No need to submit details",
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

          <div className="grid gap-1.5">
            <Label>Attach now (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {bill && (
                <FilePickButton
                  label="Add bill"
                  kind="BILL"
                  onPick={(f) => setFiles((x) => [...x, ...f])}
                />
              )}
              <FilePickButton
                label="Add photos"
                kind="PHOTO"
                multiple
                onPick={(f) => setFiles((x) => [...x, ...f])}
              />
            </div>
            {files.length > 0 && (
              <ul className="grid gap-1 text-xs">
                {files.map((f, i) => (
                  <li
                    key={`${f.file.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2 py-1"
                  >
                    <span className="truncate">
                      {f.kind === "BILL" ? "Bill" : "Photo"} · {f.file.name}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}
                    >
                      Take out
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Photos or PDF, up to 5 MB each. You can also add them later from the request.
            </p>
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
            {uploading ? `Adding ${uploading}…` : "Send request"}
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

/** A button that opens the file picker and hands back the chosen files with their kind. */
function FilePickButton({
  label,
  kind,
  multiple,
  onPick,
}: {
  label: string;
  kind: AttachmentKind;
  multiple?: boolean;
  onPick: (files: { kind: AttachmentKind; file: File }[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={FILE_ACCEPT}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onPick(Array.from(e.target.files ?? []).map((file) => ({ kind, file })));
          e.target.value = "";
        }}
      />
    </>
  );
}
