import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import {
  fetchOrder,
  submitInvoice,
  recordPayment,
  editBilling,
  editPaymentDetails,
  getFollowUps,
  createFollowUp,
} from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Receipt,
  IndianRupee,
  CheckCircle2,
  Pencil,
  X,
  MessageSquarePlus,
  Clock,
} from "lucide-react";
import { inr } from "@/lib/format";
import { useAuth } from "@/lib/auth-store";
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

  const [invoiceNo, setInvoiceNo] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billingDate, setBillingDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [submitting, setSubmitting] = useState(false);
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payingSubmit, setPayingSubmit] = useState(false);

  // Edit mode states
  const [editingBilling, setEditingBilling] = useState(false);
  const [editInvoiceNo, setEditInvoiceNo] = useState("");
  const [editBillAmount, setEditBillAmount] = useState("");
  const [editBillingDate, setEditBillingDate] = useState("");

  const [editingPayment, setEditingPayment] = useState(false);
  const [editAmountReceived, setEditAmountReceived] = useState("");
  const [editPaymentDate, setEditPaymentDate] = useState("");

  // Follow-up state
  const [followUpNote, setFollowUpNote] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["follow-ups", id],
    queryFn: () => getFollowUps(Number(id)),
    enabled: !!data?.order?.billing_completed_at,
  });

  const editBillingMutation = useMutation({
    mutationFn: (payload: { invoice_no?: string; bill_amount?: number; billing_date?: string }) =>
      editBilling(Number(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setEditingBilling(false);
      toast.success("Billing details updated");
    },
    onError: (err: any) =>
      toast.error("Failed to update", { description: err?.response?.data?.message || err.message }),
  });

  const editPaymentMutation = useMutation({
    mutationFn: (payload: { amount_received?: number; payment_date?: string }) =>
      editPaymentDetails(Number(id), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setEditingPayment(false);
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

  const order = data.order;
  const hasProduction = (order.items ?? []).some((i: any) => (i.assignments?.length ?? 0) > 0);
  const canInvoice = order.status === "Installed" || (order.status === "Active" && !hasProduction);
  const awaitingInstall = order.status === "Active" && hasProduction;

  const openBillingEdit = () => {
    setEditInvoiceNo(order.invoice_no || "");
    setEditBillAmount(String(order.bill_amount ?? ""));
    setEditBillingDate(order.billing_date ? format(new Date(order.billing_date), "yyyy-MM-dd") : "");
    setEditingBilling(true);
  };

  const openPaymentEdit = () => {
    setEditAmountReceived(String(order.amount_received ?? ""));
    setEditPaymentDate(order.payment_received_at ? format(new Date(order.payment_received_at), "yyyy-MM-dd") : "");
    setEditingPayment(true);
  };

  const handleInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNo || !billAmount) {
      toast.error("Please enter invoice number, bill amount, and billing date.");
      return;
    }
    const amt = Number(billAmount);
    if (amt > order.total_amount!) {
      toast.error("Bill amount cannot exceed the order's total value.");
      return;
    }
    setSubmitting(true);
    try {
      await submitInvoice(Number(id), invoiceNo, amt, billingDate);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.success(`Order ${order.order_no} billed!`);
      navigate({ to: "/accountant/billing" });
    } catch (err: any) {
      toast.error("Failed to submit invoice", { description: err.message || "Unknown error" });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amountReceived);
    if (!amountReceived || amt < 0) {
      toast.error("Enter the amount received.");
      return;
    }
    if (amt > Number(order.bill_amount ?? 0)) {
      toast.error("Amount received cannot exceed the billed amount.");
      return;
    }
    setPayingSubmit(true);
    try {
      await recordPayment(Number(id), amt, paymentDate);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.success(`Payment recorded for ${order.order_no}`);
      navigate({ to: "/accountant/billing" });
    } catch (err: any) {
      toast.error("Failed to record payment", {
        description: err?.response?.data?.message || err.message,
      });
    } finally {
      setPayingSubmit(false);
    }
  };

  const handleBillingEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {};
    if (editInvoiceNo !== (order.invoice_no || "")) payload.invoice_no = editInvoiceNo;
    if (editBillAmount !== String(order.bill_amount ?? ""))
      payload.bill_amount = Number(editBillAmount);
    if (editBillingDate && editBillingDate !== (order.billing_date ? format(new Date(order.billing_date), "yyyy-MM-dd") : ""))
      payload.billing_date = editBillingDate;
    if (Object.keys(payload).length === 0) {
      toast.info("No changes to save.");
      return;
    }
    editBillingMutation.mutate(payload);
  };

  const handlePaymentEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {};
    if (editAmountReceived !== String(order.amount_received ?? ""))
      payload.amount_received = Number(editAmountReceived);
    if (editPaymentDate && editPaymentDate !== (order.payment_received_at ? format(new Date(order.payment_received_at), "yyyy-MM-dd") : ""))
      payload.payment_date = editPaymentDate;
    if (Object.keys(payload).length === 0) {
      toast.info("No changes to save.");
      return;
    }
    editPaymentMutation.mutate(payload);
  };

  const billingDone = !!order.billing_completed_at;
  const paymentDone = !!order.payment_received_at;

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
        actions={
          <>
            {/* Step indicator */}
            <div className="mb-6 flex items-center gap-2 text-xs font-medium">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${billingDone ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}
              >
                {billingDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Receipt className="h-3.5 w-3.5" />
                )}{" "}
                1. Billing
              </span>
              <span className="h-px w-6 bg-border" />
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${paymentDone ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
              >
                {paymentDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <IndianRupee className="h-3.5 w-3.5" />
                )}{" "}
                2. Payment
              </span>
            </div>

            {/* Awaiting install */}
            {awaitingInstall && (
              <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
                This order is still in production / awaiting installation confirmation from the
                employee. It can't be invoiced yet.
              </div>
            )}

            {/* Record Invoice */}
            {canInvoice && (
              <div className="rounded-xl border bg-card p-6">
                <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold">
                  <Receipt className="h-5 w-5 text-primary" /> Record Invoice
                </h3>
                {order.loss_amount ? (
                  <p className="mb-4 text-xs text-muted-foreground">
                    Billable total is {inr(order.total_amount ?? 0)} — excludes{" "}
                    {inr(order.loss_amount)} in confirmed loss items.
                  </p>
                ) : null}
                <form onSubmit={handleInvoice} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Invoice Number</label>
                    <Input
                      placeholder="e.g. INV-2024-001"
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Bill Amount (₹)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={order.total_amount}
                      placeholder={String(order.total_amount)}
                      value={billAmount}
                      onChange={(e) => setBillAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Billing Date</label>
                    <Input
                      type="date"
                      value={billingDate}
                      max={format(new Date(), "yyyy-MM-dd")}
                      onChange={(e) => setBillingDate(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={submitting} className="h-10 w-full sm:w-auto">
                    {submitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      "Submit Invoice"
                    )}
                  </Button>
                </form>
              </div>
            )}

            {/* Billing details (after billing) — with edit option */}
            {billingDone && !editingBilling && (
              <div className="rounded-xl border bg-card p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Receipt className="h-4 w-4 text-primary" /> Billing Details
                  </h3>
                  {order.status !== "Completed" && (
                    <Button variant="ghost" size="sm" onClick={openBillingEdit}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </div>
                <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
                  <div>
                    Invoice:{" "}
                    <span className="font-medium text-foreground">{order.invoice_no}</span>
                  </div>
                  <div>
                    Billed:{" "}
                    <span className="font-medium text-foreground">
                      {inr(order.bill_amount ?? 0)}
                    </span>
                  </div>
                  <div>
                    Billing Date:{" "}
                    <span className="font-medium text-foreground">
                      {order.billing_date
                        ? format(new Date(order.billing_date), "MMM d, yyyy")
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Billing edit form */}
            {editingBilling && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4 text-primary" /> Edit Billing Details
                  </h3>
                  <Button variant="ghost" size="icon" onClick={() => setEditingBilling(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Changes will be logged in the audit trail and the admin will be notified via
                  email.
                </p>
                <form onSubmit={handleBillingEdit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Invoice Number</label>
                    <Input
                      value={editInvoiceNo}
                      onChange={(e) => setEditInvoiceNo(e.target.value)}
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Bill Amount (₹)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editBillAmount}
                      onChange={(e) => setEditBillAmount(e.target.value)}
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Billing Date</label>
                    <Input
                      type="date"
                      value={editBillingDate}
                      max={format(new Date(), "yyyy-MM-dd")}
                      onChange={(e) => setEditBillingDate(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={editBillingMutation.isPending} className="h-10 w-full sm:w-auto">
                    {editBillingMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </form>
              </div>
            )}

            {/* Record Payment */}
            {order.status === "BillingCompleted" && (
              <div className="rounded-xl border bg-card p-6">
                <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
                  <IndianRupee className="h-5 w-5 text-primary" /> Record Payment
                </h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Invoice{" "}
                  <span className="font-medium">{order.invoice_no}</span> billed at{" "}
                  {inr(order.bill_amount ?? 0)}. Record what was received.
                </p>
                <form onSubmit={handlePayment} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Amount Received (₹)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={order.bill_amount ?? undefined}
                      placeholder={String(order.bill_amount ?? "")}
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Payment Date</label>
                    <Input
                      type="date"
                      value={paymentDate}
                      max={format(new Date(), "yyyy-MM-dd")}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={payingSubmit} className="h-10 w-full sm:w-auto">
                    {payingSubmit ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      "Confirm Payment"
                    )}
                  </Button>
                </form>
              </div>
            )}

            {/* Payment details (after payment) — with edit option */}
            {paymentDone && !editingPayment && (
              <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-success">
                    <CheckCircle2 className="h-5 w-5" /> Fully settled
                  </div>
                  {order.status !== "Completed" && (
                    <Button variant="ghost" size="sm" onClick={openPaymentEdit}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </div>
                <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                  <div>
                    Invoice:{" "}
                    <span className="font-medium text-foreground">{order.invoice_no}</span>
                  </div>
                  <div>
                    Billed:{" "}
                    <span className="font-medium text-foreground">
                      {inr(order.bill_amount ?? 0)}
                    </span>
                  </div>
                  <div>
                    Received:{" "}
                    <span className="font-medium text-foreground">
                      {inr(order.amount_received ?? 0)}
                    </span>
                  </div>
                  <div>
                    Paid on:{" "}
                    <span className="font-medium text-foreground">
                      {order.payment_received_at
                        ? format(new Date(order.payment_received_at), "MMM d, yyyy")
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Payment edit form */}
            {editingPayment && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4 text-primary" /> Edit Payment Details
                  </h3>
                  <Button variant="ghost" size="icon" onClick={() => setEditingPayment(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Changes will be logged in the audit trail and the admin will be notified via
                  email.
                </p>
                <form onSubmit={handlePaymentEdit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Amount Received (₹)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editAmountReceived}
                      onChange={(e) => setEditAmountReceived(e.target.value)}
                    />
                  </div>
                  <div className="w-full flex-1 space-y-2">
                    <label className="text-sm font-medium">Payment Date</label>
                    <Input
                      type="date"
                      value={editPaymentDate}
                      max={format(new Date(), "yyyy-MM-dd")}
                      onChange={(e) => setEditPaymentDate(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={editPaymentMutation.isPending} className="h-10 w-full sm:w-auto">
                    {editPaymentMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </form>
              </div>
            )}

            {/* Payment Follow-Up System */}
            {billingDone && (
              <div className="rounded-xl border bg-card p-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <MessageSquarePlus className="h-4 w-4 text-primary" /> Payment Follow-Up Notes
                </h3>

                {/* Add follow-up form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!followUpNote.trim()) return;
                    followUpMutation.mutate(followUpNote.trim());
                  }}
                  className="mb-4 flex gap-3"
                >
                  <Textarea
                    placeholder="Add a follow-up note (e.g. 'Called client, payment promised by Friday')..."
                    rows={2}
                    value={followUpNote}
                    onChange={(e) => setFollowUpNote(e.target.value)}
                    className="flex-1 resize-none"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!followUpNote.trim() || followUpMutation.isPending}
                    className="self-end"
                  >
                    {followUpMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Add"
                    )}
                  </Button>
                </form>

                {/* Timeline */}
                {followUps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No follow-up notes yet. Add a note to track payment follow-ups.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {followUps.map((fu: any) => (
                      <div key={fu.id} className="flex gap-3 border-l-2 border-primary/20 pl-4">
                        <div className="flex-1">
                          <p className="text-sm text-foreground">{fu.note}</p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(fu.created_at), { addSuffix: true })}
                            {fu.author && (
                              <>
                                <span>·</span>
                                <span className="font-medium">{fu.author.name}</span>
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                                  {fu.author.role}
                                </span>
                              </>
                            )}
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
