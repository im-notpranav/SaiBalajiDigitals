import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import {
  fetchOrder,
  createInvoice,
  recordInvoicePayment,
  editInvoiceBilling,
  editInvoicePayment,
  getFollowUps,
  createFollowUp,
} from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Receipt,
  IndianRupee,
  CheckCircle2,
  Pencil,
  X,
  MessageSquarePlus,
  Clock,
  Store,
} from "lucide-react";
import { inr } from "@/lib/format";
import { useAuth } from "@/lib/auth-store";
import { storeRef, billingRollup } from "@/lib/stores";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_portal/accountant/billing_/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailAccountant,
});

function OrderDetailAccountant() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // New invoice
  const [invoiceNo, setInvoiceNo] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billingDate, setBillingDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedStores, setSelectedStores] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Per-invoice payment and edit forms, keyed by invoice id.
  const [payingId, setPayingId] = useState<number | null>(null);
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const [editingBillingId, setEditingBillingId] = useState<number | null>(null);
  const [editInvoiceNo, setEditInvoiceNo] = useState("");
  const [editBillAmount, setEditBillAmount] = useState("");
  const [editBillingDate, setEditBillingDate] = useState("");

  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [editAmountReceived, setEditAmountReceived] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");

  const [followUpNote, setFollowUpNote] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["follow-ups", id],
    queryFn: () => getFollowUps(Number(id)),
    enabled: !!(data?.order && billingRollup(data.order).billing_completed_at),
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ["order", id] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const payMutation = useMutation({
    mutationFn: ({ invoiceId, amount, date }: { invoiceId: number; amount: number; date: string }) =>
      recordInvoicePayment(Number(id), invoiceId, amount, date),
    onSuccess: () => {
      refetchAll();
      setPayingId(null);
      setAmountReceived("");
      toast.success("Payment recorded");
    },
    onError: (err: any) =>
      toast.error("Failed to record payment", { description: err?.response?.data?.message || err.message }),
  });

  const editBillingMutation = useMutation({
    mutationFn: ({ invoiceId, payload }: { invoiceId: number; payload: any }) =>
      editInvoiceBilling(Number(id), invoiceId, payload),
    onSuccess: () => {
      refetchAll();
      setEditingBillingId(null);
      toast.success("Billing details updated");
    },
    onError: (err: any) =>
      toast.error("Failed to update", { description: err?.response?.data?.message || err.message }),
  });

  const editPaymentMutation = useMutation({
    mutationFn: ({ invoiceId, payload }: { invoiceId: number; payload: any }) =>
      editInvoicePayment(Number(id), invoiceId, payload),
    onSuccess: () => {
      refetchAll();
      setEditingPaymentId(null);
      toast.success("Payment details updated");
    },
    onError: (err: any) =>
      toast.error("Failed to update", { description: err?.response?.data?.message || err.message }),
  });

  const followUpMutation = useMutation({
    mutationFn: (note: string) => createFollowUp(Number(id), note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups", id] });
      setFollowUpNote("");
      toast.success("Follow-up note added");
    },
    onError: (err: any) =>
      toast.error("Failed to add note", { description: err?.response?.data?.message || err.message }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const order: any = data.order;
  const stores: any[] = order.stores ?? [];
  const invoices: any[] = order.invoices ?? [];
  const storesOf = (invoiceId: number) => stores.filter((s) => s.invoice_id === invoiceId);

  /**
   * A store can go on an invoice once its own production is finished and it has been
   * installed. A supply-only store — nothing was ever assigned to production — bills
   * straight away, as it always has.
   */
  const storeReady = (s: any) => {
    const assigned = (s.items ?? []).filter((i: any) => (i.assignments?.length ?? 0) > 0);
    if (assigned.length === 0) return true;
    if (assigned.some((i: any) => !i.production_completed)) return false;
    return s.installed_at != null;
  };

  const unbilled = stores.filter((s) => s.invoice_id == null);
  const billable = unbilled.filter(storeReady);
  const notReady = unbilled.filter((s) => !storeReady(s));
  const orderClosed = order.status === "Completed" || order.status === "PaymentReceived";
  const canInvoice = billable.length > 0 && !orderClosed;

  const coveredTotal = billable
    .filter((s) => selectedStores.includes(s.id))
    .reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);

  const toggleStore = (storeId: number) =>
    setSelectedStores((cur) =>
      cur.includes(storeId) ? cur.filter((x) => x !== storeId) : [...cur, storeId]
    );

  const handleInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedStores.length === 0) {
      toast.error("Select at least one store for this invoice.");
      return;
    }
    if (!invoiceNo || !billAmount) {
      toast.error("Enter an invoice number, bill amount and billing date.");
      return;
    }
    const amt = Number(billAmount);
    if (amt > coveredTotal) {
      toast.error(`Bill amount cannot exceed ${inr(coveredTotal)} across the selected store(s).`);
      return;
    }
    setSubmitting(true);
    try {
      await createInvoice(Number(id), {
        invoice_no: invoiceNo,
        bill_amount: amt,
        billing_date: billingDate,
        store_ids: selectedStores,
      });
      refetchAll();
      setInvoiceNo("");
      setBillAmount("");
      setSelectedStores([]);
      toast.success(`Invoice raised on ${order.order_no}`);
    } catch (err: any) {
      toast.error("Failed to submit invoice", {
        description: err?.response?.data?.message || err.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openBillingEdit = (inv: any) => {
    setEditInvoiceNo(inv.invoice_no || "");
    setEditBillAmount(String(inv.bill_amount ?? ""));
    setEditBillingDate(inv.billing_date ? format(new Date(inv.billing_date), "yyyy-MM-dd") : "");
    setEditingBillingId(inv.id);
  };

  const openPaymentEdit = (inv: any) => {
    setEditAmountReceived(String(inv.amount_received ?? ""));
    setEditPaymentDate(inv.payment_received_at ? format(new Date(inv.payment_received_at), "yyyy-MM-dd") : "");
    setEditingPaymentId(inv.id);
  };

  const submitBillingEdit = (e: React.FormEvent, inv: any) => {
    e.preventDefault();
    const payload: any = {};
    if (editInvoiceNo !== (inv.invoice_no || "")) payload.invoice_no = editInvoiceNo;
    if (editBillAmount !== String(inv.bill_amount ?? "")) payload.bill_amount = Number(editBillAmount);
    const prevDate = inv.billing_date ? format(new Date(inv.billing_date), "yyyy-MM-dd") : "";
    if (editBillingDate && editBillingDate !== prevDate) payload.billing_date = editBillingDate;
    if (Object.keys(payload).length === 0) return toast.info("No changes to save.");
    editBillingMutation.mutate({ invoiceId: inv.id, payload });
  };

  const submitPaymentEdit = (e: React.FormEvent, inv: any) => {
    e.preventDefault();
    const payload: any = {};
    if (editAmountReceived !== String(inv.amount_received ?? "")) payload.amount_received = Number(editAmountReceived);
    const prevDate = inv.payment_received_at ? format(new Date(inv.payment_received_at), "yyyy-MM-dd") : "";
    if (editPaymentDate && editPaymentDate !== prevDate) payload.payment_date = editPaymentDate;
    if (Object.keys(payload).length === 0) return toast.info("No changes to save.");
    editPaymentMutation.mutate({ invoiceId: inv.id, payload });
  };

  const totalBilled = invoices.reduce((s, i) => s + Number(i.bill_amount ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + Number(i.amount_received ?? 0), 0);
  const billingDone = invoices.length > 0;
  const paymentDone = invoices.length > 0 && invoices.every((i) => i.amount_received != null);

  return (
    <>
      <PageHeader
        title={`Order ${order.order_no}`}
        description="Verify order details prior to billing."
        crumbs={[
          { label: "Accountant" },
          { label: "Billing Queue", to: "/accountant/billing" },
          { label: "Details" },
        ]}
      />

      <OrderDetail
        order={order}
        userRole={user?.role}
        currentUserId={user?.id}
        actions={
          <>
            {/* Step indicator */}
            <div className="mb-6 flex items-center gap-2 text-xs font-medium">
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${billingDone ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}>
                {billingDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />} 1. Billing
              </span>
              <span className="h-px w-6 bg-border" />
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${paymentDone ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {paymentDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <IndianRupee className="h-3.5 w-3.5" />} 2. Payment
              </span>
            </div>

            {/* Running totals across every invoice on the order */}
            {invoices.length > 0 && (
              <div className="mb-6 grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Order billable</div>
                  <div className="font-semibold">{inr(order.total_amount ?? 0)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Billed across {invoices.length} invoice{invoices.length === 1 ? "" : "s"}</div>
                  <div className="font-semibold">{inr(totalBilled)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Received</div>
                  <div className="font-semibold">{inr(totalPaid)}</div>
                </div>
              </div>
            )}

            {/* Stores that cannot be billed yet */}
            {notReady.length > 0 && (
              <div className="mb-4 rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
                Waiting on {notReady.length} store{notReady.length === 1 ? "" : "s"}:{" "}
                {notReady.map((s) => s.store_name).join(", ")}. Each must finish production and be
                installation-confirmed before it can go on an invoice.
              </div>
            )}

            {/* Raise an invoice over a set of stores */}
            {canInvoice && (
              <div className="rounded-xl border bg-card p-6">
                <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold">
                  <Receipt className="h-5 w-5 text-primary" /> Raise Invoice
                </h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Pick the stores this invoice covers. Its expected value is the billable total of
                  just those stores.
                  {order.loss_amount ? ` Confirmed losses of ${inr(order.loss_amount)} are excluded.` : ""}
                </p>

                <div className="mb-4 space-y-2">
                  {billable.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border bg-background/60 p-3 text-sm hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={selectedStores.includes(s.id)}
                        onCheckedChange={() => toggleStore(s.id)}
                      />
                      <Store className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{storeRef(s)}</span>
                        <span className="ml-2 text-muted-foreground">{s.location}</span>
                        {s.po_number && <span className="ml-2 text-xs text-muted-foreground">PO {s.po_number}</span>}
                      </span>
                      <span className="font-semibold">{inr(Number(s.total_amount ?? 0))}</span>
                    </label>
                  ))}
                </div>

                <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {selectedStores.length} store{selectedStores.length === 1 ? "" : "s"} selected
                  </span>
                  <span className="font-semibold">Covered total {inr(coveredTotal)}</span>
                </div>

                <form onSubmit={handleInvoice} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Invoice Number</label>
                    <Input placeholder="e.g. INV-2024-001" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} required />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Bill Amount (₹)</label>
                    <Input
                      type="number" step="0.01" min="0" max={coveredTotal || undefined}
                      placeholder={String(coveredTotal || "")}
                      value={billAmount} onChange={(e) => setBillAmount(e.target.value)} required
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Billing Date</label>
                    <Input
                      type="date" value={billingDate} max={format(new Date(), "yyyy-MM-dd")}
                      onChange={(e) => setBillingDate(e.target.value)} required
                    />
                  </div>
                  <Button type="submit" disabled={submitting || selectedStores.length === 0} className="h-10 w-full sm:w-auto">
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Submit Invoice"}
                  </Button>
                </form>
              </div>
            )}

            {/* Invoices already on this order */}
            {invoices.map((inv) => {
              const covered = storesOf(inv.id);
              const paid = inv.amount_received != null;
              const paidInFull = paid && Number(inv.amount_received) === Number(inv.bill_amount);
              return (
                <div key={inv.id} className="mt-4 rounded-xl border bg-card p-6">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Receipt className="h-4 w-4 text-primary" /> Invoice {inv.invoice_no}
                        {paid && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${paidInFull ? "bg-success/15 text-success" : "bg-warning/15 text-amber-600"}`}>
                            {paidInFull ? "Paid in full" : "Part paid"}
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Covers {covered.length > 0 ? covered.map((s) => s.store_name).join(", ") : "—"}
                      </p>
                    </div>
                    {order.status !== "Completed" && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openBillingEdit(inv)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Billing
                        </Button>
                        {paid && (
                          <Button variant="ghost" size="sm" onClick={() => openPaymentEdit(inv)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Payment
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-4">
                    <div>Billed: <span className="font-medium text-foreground">{inr(inv.bill_amount ?? 0)}</span></div>
                    <div>Date: <span className="font-medium text-foreground">{inv.billing_date ? format(new Date(inv.billing_date), "MMM d, yyyy") : "—"}</span></div>
                    <div>Received: <span className="font-medium text-foreground">{paid ? inr(inv.amount_received) : "—"}</span></div>
                    <div>Paid on: <span className="font-medium text-foreground">{inv.payment_received_at ? format(new Date(inv.payment_received_at), "MMM d, yyyy") : "—"}</span></div>
                  </div>

                  {/* Edit billing */}
                  {editingBillingId === inv.id && (
                    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Edit billing</h4>
                        <Button variant="ghost" size="icon" onClick={() => setEditingBillingId(null)}><X className="h-4 w-4" /></Button>
                      </div>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Changes are logged in the audit trail and the admin is notified by email.
                      </p>
                      <form onSubmit={(e) => submitBillingEdit(e, inv)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Invoice Number</label>
                          <Input value={editInvoiceNo} onChange={(e) => setEditInvoiceNo(e.target.value)} />
                        </div>
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Bill Amount (₹)</label>
                          <Input type="number" step="0.01" min="0" value={editBillAmount} onChange={(e) => setEditBillAmount(e.target.value)} />
                        </div>
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Billing Date</label>
                          <Input type="date" value={editBillingDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setEditBillingDate(e.target.value)} />
                        </div>
                        <Button type="submit" disabled={editBillingMutation.isPending} className="h-10 w-full sm:w-auto">
                          {editBillingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                      </form>
                    </div>
                  )}

                  {/* Edit payment */}
                  {editingPaymentId === inv.id && (
                    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Edit payment</h4>
                        <Button variant="ghost" size="icon" onClick={() => setEditingPaymentId(null)}><X className="h-4 w-4" /></Button>
                      </div>
                      <form onSubmit={(e) => submitPaymentEdit(e, inv)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Amount Received (₹)</label>
                          <Input type="number" step="0.01" min="0" max={inv.bill_amount ?? undefined} value={editAmountReceived} onChange={(e) => setEditAmountReceived(e.target.value)} />
                        </div>
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Payment Date</label>
                          <Input type="date" value={editPaymentDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setEditPaymentDate(e.target.value)} />
                        </div>
                        <Button type="submit" disabled={editPaymentMutation.isPending} className="h-10 w-full sm:w-auto">
                          {editPaymentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                      </form>
                    </div>
                  )}

                  {/* Record payment */}
                  {!paid && order.status !== "Completed" && (
                    payingId === inv.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const amt = Number(amountReceived);
                          if (!amountReceived || amt < 0) return toast.error("Enter the amount received.");
                          if (amt > Number(inv.bill_amount ?? 0)) return toast.error("Amount received cannot exceed the billed amount.");
                          payMutation.mutate({ invoiceId: inv.id, amount: amt, date: paymentDate });
                        }}
                        className="mt-4 flex flex-col gap-3 rounded-lg border bg-background/60 p-4 sm:flex-row sm:items-end"
                      >
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Amount Received (₹)</label>
                          <Input
                            type="number" step="0.01" min="0" max={inv.bill_amount ?? undefined}
                            placeholder={String(inv.bill_amount ?? "")}
                            value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} required autoFocus
                          />
                        </div>
                        <div className="w-full flex-1 space-y-1">
                          <label className="text-xs font-medium">Payment Date</label>
                          <Input type="date" value={paymentDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setPaymentDate(e.target.value)} required />
                        </div>
                        <Button type="submit" disabled={payMutation.isPending} className="h-10 w-full sm:w-auto">
                          {payMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Record"}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setPayingId(null)} className="h-10">Cancel</Button>
                      </form>
                    ) : (
                      <Button
                        variant="outline" size="sm" className="mt-4"
                        onClick={() => { setPayingId(inv.id); setAmountReceived(String(inv.bill_amount ?? "")); }}
                      >
                        <IndianRupee className="mr-1 h-3.5 w-3.5" /> Record payment
                      </Button>
                    )
                  )}
                </div>
              );
            })}

            {orderClosed && invoices.length > 0 && (
              <div className="mt-4 rounded-xl border border-success/30 bg-success/5 p-6 text-sm">
                <div className="flex items-center gap-2 font-semibold text-success">
                  <CheckCircle2 className="h-5 w-5" /> Order settled
                </div>
                <p className="mt-1 text-muted-foreground">
                  {inr(totalPaid)} received across {invoices.length} invoice{invoices.length === 1 ? "" : "s"}.
                </p>
                <Button variant="ghost" size="sm" className="mt-3 px-0" onClick={() => navigate({ to: "/accountant/billing" })}>
                  Back to the billing queue
                </Button>
              </div>
            )}

            {/* Follow-up notes */}
            {billingDone && (
              <div className="mt-4 rounded-xl border bg-card p-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquarePlus className="h-4 w-4 text-primary" /> Payment Follow-Up Notes
                </h3>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!followUpNote.trim()) return;
                    followUpMutation.mutate(followUpNote.trim());
                  }}
                  className="mb-4 flex gap-3"
                >
                  <Textarea
                    placeholder="Add a follow-up note..."
                    rows={2}
                    value={followUpNote}
                    onChange={(e) => setFollowUpNote(e.target.value)}
                    className="flex-1 resize-none"
                  />
                  <Button type="submit" size="sm" disabled={!followUpNote.trim() || followUpMutation.isPending} className="self-end">
                    {followUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </form>
                {followUps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No follow-up notes yet.</p>
                ) : (
                  <div className="space-y-3">
                    {followUps.map((fu: any) => (
                      <div key={fu.id} className="flex gap-3 border-l-2 border-primary/20 pl-4">
                        <div className="flex-1">
                          <p className="text-sm text-foreground">{fu.note}</p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(fu.created_at), { addSuffix: true })}
                            {fu.author && (<><span>·</span><span className="font-medium">{fu.author.name}</span></>)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        }
      />
    </>
  );
}
