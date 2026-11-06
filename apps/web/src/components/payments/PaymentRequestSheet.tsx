import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage, formatJobDates } from "@/api/allocation";
import {
  CATEGORY_LABELS,
  PAYMENT_STATUS_LABELS,
  fetchPaymentRequest,
  formatRupees,
  formatWhen,
  nextStepFor,
  roleLabel,
  paymentAction,
  type PaymentActionName,
  type PaymentEvent,
  type PaymentRequest,
} from "@/api/payments";
import {
  PaymentStatusBadge,
  RequestFields,
  UPI_METHOD_LABELS,
  draftFrom,
  payeeText,
  readDraft,
  type RequestDraft,
} from "./PaymentBits";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { TimerList, overdueText } from "./PaymentTimers";

/** One payment request: its details, the order's money, its history and the actions open to you. */

const ACTION_LABELS: Record<PaymentActionName, string> = {
  APPROVE: "Approve",
  REJECT: "Reject",
  RETURN: "Return for info",
  RESUBMIT: "Correct and resubmit",
  CANCEL: "Cancel request",
  MARK_PAID: "Mark paid",
  CLOSE: "Close",
};

const EVENT_LABELS: Record<PaymentEvent["action"], string> = {
  SUBMIT: "Raised",
  APPROVE: "Approved",
  REJECT: "Rejected",
  RETURN: "Returned for info",
  RESUBMIT: "Resubmitted",
  CANCEL: "Cancelled",
  MARK_PAID: "Marked paid",
  CLOSE: "Closed",
  ATTACH: "File added",
  DETACH: "File removed",
};

/** Buttons in the order they read best; the first open one is the primary action. */
const ACTION_ORDER: PaymentActionName[] = [
  "APPROVE",
  "MARK_PAID",
  "CLOSE",
  "RESUBMIT",
  "RETURN",
  "REJECT",
  "CANCEL",
];

export function PaymentRequestSheet({
  requestId,
  onClose,
}: {
  requestId: number | null;
  onClose: () => void;
}) {
  const [action, setAction] = useState<PaymentActionName | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["payment-requests", "detail", requestId],
    queryFn: () => fetchPaymentRequest(requestId!),
    enabled: requestId != null,
  });
  const r = data?.request;
  const returned = [...(data?.events ?? [])].reverse().find((e) => e.action === "RETURN");
  const actions = ACTION_ORDER.filter((a) => r?.actions.includes(a));
  // Held-up actions show disabled with the reason beside them; the API refuses them too.
  const blocked = r?.blocked_actions ?? {};
  const blockedReasons = [...new Set(actions.map((a) => blocked[a]).filter(Boolean))] as string[];

  return (
    <Sheet open={requestId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {isLoading || !r ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className={cn("break-all font-mono", overdueText(r.overdue))}>
                  {r.order.order_no}
                </span>
                <PaymentStatusBadge status={r.status} />
              </SheetTitle>
              <SheetDescription>{nextStepFor(r)}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid gap-4">
              <div className="surface-panel p-4">
                <div className="text-3xl font-semibold tabular-nums">{formatRupees(r.amount)}</div>
                <div className="mt-1 text-sm">{r.purpose}</div>
                {r.category && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {CATEGORY_LABELS[r.category]}
                  </div>
                )}
              </div>

              <TimerList timers={r.timers} />

              {r.status === "INFO_REQUESTED" && returned?.note && (
                <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                  <div className="font-medium">
                    Returned by {returned.actor?.name ?? "a reviewer"}
                  </div>
                  <div className="mt-0.5">{returned.note}</div>
                </div>
              )}

              {r.order_money && <OrderMoneyPanel request={r} />}

              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <Row label="Order">
                  <span className="font-mono">{r.order.order_no}</span> · {r.order.client_name}
                </Row>
                {r.work_job && (
                  <Row label="Field job">
                    {r.work_job.work_details}
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatJobDates(r.work_job.start_date, r.work_job.start_date)}
                    </span>
                  </Row>
                )}
                <Row label="Requested by">
                  {r.requester.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {roleLabel(r.requester.role)}
                    {r.requester.phone ? ` · ${r.requester.phone}` : ""}
                  </span>
                </Row>
                <Row label="Pay to">
                  <span className="block text-xs text-muted-foreground">
                    {UPI_METHOD_LABELS[r.upi_method]}
                  </span>
                  <span className="inline-flex max-w-full items-start gap-1.5 font-mono">
                    <span className="break-all">{payeeText(r)}</span>
                    <button
                      type="button"
                      aria-label={`Copy ${UPI_METHOD_LABELS[r.upi_method]}`}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        void navigator.clipboard?.writeText(r.upi_id);
                        toast.success(`${UPI_METHOD_LABELS[r.upi_method]} copied`);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </Row>
                <Row label="Bill details">
                  {r.bill_details_required
                    ? "Yes: approved for payment only once the bill is attached"
                    : "No: Admin, then Cost Control"}
                </Row>
                {r.remarks && <Row label="Remarks">{r.remarks}</Row>}
                <Row label="Raised">{formatWhen(r.created_at)}</Row>
                {r.paid_at && (
                  <Row label="Paid">
                    {formatRupees(r.paid_amount)} · ref{" "}
                    <span className="font-mono">{r.payment_reference}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {r.payer?.name} · {formatWhen(r.paid_at)}
                    </span>
                  </Row>
                )}
                {r.closed_at && (
                  <Row label="Closed">
                    {r.closer?.name} · {formatWhen(r.closed_at)}
                  </Row>
                )}
              </dl>

              <AttachmentsPanel request={r} attachments={data?.attachments ?? []} />

              {actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => (
                    <Button
                      key={a}
                      variant={
                        i === 0
                          ? "default"
                          : a === "REJECT" || a === "CANCEL"
                            ? "outline"
                            : "secondary"
                      }
                      className={cn(a === "REJECT" && "text-destructive")}
                      disabled={!!blocked[a]}
                      title={blocked[a]}
                      onClick={() => setAction(a)}
                    >
                      {ACTION_LABELS[a]}
                    </Button>
                  ))}
                  {blockedReasons.map((why) => (
                    <p key={why} className="w-full text-xs text-muted-foreground">
                      {why}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-2 text-sm font-semibold">History</div>
                <ol className="grid gap-3 border-l pl-4">
                  {(data?.events ?? []).map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-primary/70" />
                      <div>
                        <span className="font-medium">{EVENT_LABELS[e.action]}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.actor?.name ?? "—"} · {formatWhen(e.created_at)}
                        </span>
                      </div>
                      {/* File events leave the status where it was. */}
                      {e.from_status !== e.to_status && (
                        <div className="text-xs text-muted-foreground">
                          → {PAYMENT_STATUS_LABELS[e.to_status]}
                        </div>
                      )}
                      {e.note && <div className="mt-0.5 text-muted-foreground">{e.note}</div>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <ActionDialog request={r} action={action} onClose={() => setAction(null)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function OrderMoneyPanel({ request }: { request: PaymentRequest }) {
  const m = request.order_money!;
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        m.over_value && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Order value" value={formatRupees(m.order_value)} />
        <Stat label={`Asked (${m.requests})`} value={formatRupees(m.requested)} />
        <Stat label="Paid out" value={formatRupees(m.paid)} />
      </div>
      {m.over_value && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Requests on this order add up to more than its
          value.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Confirm an action, collecting what it needs: a reason, the payment reference, or corrections. */
function ActionDialog({
  request,
  action,
  onClose,
}: {
  request: PaymentRequest;
  action: PaymentActionName | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [draft, setDraft] = useState<RequestDraft>(draftFrom(request));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setNote("");
    setReference("");
    setPaidAmount(String(request.amount));
    setDraft(draftFrom(request));
    setError(null);
  }, [action, request]);

  const run = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentAction(request.id, action!, data),
    onSuccess: (res) => {
      toast.success(
        `Request on ${res.request.order.order_no}: ${PAYMENT_STATUS_LABELS[res.request.status]}`,
      );
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err, "That did not work")),
  });

  if (!action) return null;
  const paid = Number(paidAmount);
  const paysShort = action === "MARK_PAID" && Number.isFinite(paid) && paid > 0 && paid < request.amount - 0.005;
  const reasonRequired =
    action === "REJECT" ||
    action === "RETURN" ||
    (action === "CANCEL" && !request.is_mine) ||
    paysShort;
  // Asking for more, or a new payee, sends a returned request back to the start (GAP-D02).
  const read = action === "RESUBMIT" ? readDraft(draft) : null;
  const restartsReview =
    !!read &&
    "input" in read &&
    (read.input.amount > request.amount + 0.005 ||
      read.input.upi_method !== request.upi_method ||
      read.input.upi_id !== request.upi_id);

  const submit = () => {
    setError(null);
    if (action === "RESUBMIT" && read) {
      if ("error" in read) return setError(read.error);
      return run.mutate({ ...read.input, note: note.trim() || null });
    }
    if (action === "MARK_PAID") {
      if (!Number.isFinite(paid) || paid <= 0) return setError("Enter the amount paid.");
      if (paid > request.amount)
        return setError(`Cannot pay more than the ${formatRupees(request.amount)} asked for.`);
      if (reference.trim().length < 4) return setError("Enter the UTR or bank reference.");
      if (paysShort && !note.trim())
        return setError(`Say why ${formatRupees(request.amount - paid)} less than asked is being paid.`);
      return run.mutate({
        paid_amount: paid,
        payment_reference: reference.trim(),
        note: note.trim() || null,
      });
    }
    if (reasonRequired && !note.trim()) return setError("Give a reason.");
    run.mutate({ note: note.trim() || null });
  };

  const descriptions: Record<PaymentActionName, string> = {
    APPROVE:
      request.status === "ADMIN_REVIEW"
        ? "It moves on to Cost Control for their approval."
        : "It moves to payment pending. Pay it, then mark it paid here.",
    REJECT: "The requester is told why. A rejected request cannot be reopened.",
    RETURN: "It goes back to the requester to correct and resubmit. Say what is missing.",
    RESUBMIT:
      "Correct the details and send it back to the same reviewer. Asking for more, or changing where it is paid, starts review again from the beginning.",
    CANCEL: request.is_mine
      ? "Withdraw this request."
      : request.status === "PAYMENT_PENDING"
        ? "Cancel this approved request. Only do this if the money has not been sent. The requester is told why."
        : "Cancel this request. The requester is told why.",
    MARK_PAID: `Record the payment to ${payeeText(request)}.`,
    CLOSE: "Close the request once the payment and paperwork are settled.",
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ACTION_LABELS[action]} · {request.order.order_no}
          </DialogTitle>
          <DialogDescription>{descriptions[action]}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {action === "RESUBMIT" && <RequestFields draft={draft} onChange={setDraft} />}
          {restartsReview && (
            <div className="flex items-start gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This asks for more or changes where it is paid, so review starts again from the
              beginning.
            </div>
          )}
          {action === "MARK_PAID" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pr-paid">Amount paid (₹)</Label>
                <Input
                  id="pr-paid"
                  inputMode="decimal"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pr-ref">UTR / reference</Label>
                <Input
                  id="pr-ref"
                  value={reference}
                  maxLength={64}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="pr-note">
              {paysShort
                ? `Why ${formatRupees(request.amount - paid)} less is paid`
                : reasonRequired
                  ? "Reason"
                  : "Note (optional)"}
            </Label>
            <Textarea
              id="pr-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Back
          </Button>
          <Button
            onClick={submit}
            disabled={run.isPending}
            variant={action === "REJECT" || action === "CANCEL" ? "destructive" : "default"}
          >
            {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {ACTION_LABELS[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
