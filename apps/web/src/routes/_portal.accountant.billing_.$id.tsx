import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder, submitInvoice, recordPayment } from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Receipt, IndianRupee, CheckCircle2 } from "lucide-react";
import { inr } from "@/lib/format";
import { useAuth } from "@/lib/auth-store";
import { format } from "date-fns";

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
  const [submitting, setSubmitting] = useState(false);
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [payingSubmit, setPayingSubmit] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const order = data.order;
  const hasProduction = (order.items ?? []).some((i) => (i.assignments?.length ?? 0) > 0);
  // Production orders bill only once installed; supply-only orders bill from Active.
  const canInvoice = order.status === "Installed" || (order.status === "Active" && !hasProduction);
  const awaitingInstall = order.status === "Active" && hasProduction;

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
      toast.error("Failed to record payment", { description: err?.response?.data?.message || err.message });
    } finally {
      setPayingSubmit(false);
    }
  };

  const handleInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNo || !billAmount) {
      toast.error("Please enter both invoice number and bill amount.");
      return;
    }
    const amt = Number(billAmount);
    if (amt > order.total_amount!) {
      toast.error("Bill amount cannot exceed the order's total value.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitInvoice(Number(id), invoiceNo, amt);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      
      toast.success(`Order ${order.order_no} completely billed!`);
      navigate({ to: "/accountant/billing" });
    } catch (err: any) {
      toast.error("Failed to submit invoice", { description: err.message || "Unknown error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Order ${order.order_no}`}
        description="Verify order details prior to billing."
        crumbs={[{ label: "Accountant" }, { label: "Billing Queue", to: "/accountant/billing" }, { label: "Details" }]}
      />
      
      <OrderDetail
        order={order}
        userRole={user?.role}
        actions={
          <>
            {/* Two-step accountant flow: 1) Record Invoice  2) Record Payment */}
            <div className="mb-6 flex items-center gap-2 text-xs font-medium">
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${order.billing_completed_at ? "bg-success/15 text-success" : "bg-primary/15 text-primary"}`}>
                {order.billing_completed_at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />} 1. Billing
              </span>
              <span className="h-px w-6 bg-border" />
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${order.payment_received_at ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                {order.payment_received_at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <IndianRupee className="h-3.5 w-3.5" />} 2. Payment
              </span>
            </div>

            {awaitingInstall && (
              <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
                This order is still in production / awaiting installation confirmation from the employee. It can't be invoiced yet.
              </div>
            )}

            {canInvoice && (
              <div className="rounded-xl border bg-card p-6">
                <h3 className="mb-2 text-lg font-semibold flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-primary" /> Record Invoice
                </h3>
                {order.loss_amount ? (
                  <p className="mb-4 text-xs text-muted-foreground">
                    Billable total is {inr(order.total_amount ?? 0)} — excludes {inr(order.loss_amount)} in confirmed loss items.
                  </p>
                ) : null}
                <form onSubmit={handleInvoice} className="flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex-1 w-full space-y-2">
                    <label className="text-sm font-medium">Invoice Number</label>
                    <Input placeholder="e.g. INV-2024-001" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} required />
                  </div>
                  <div className="flex-1 w-full space-y-2">
                    <label className="text-sm font-medium">Bill Amount (₹)</label>
                    <Input type="number" step="0.01" min="0" max={order.total_amount} placeholder={String(order.total_amount)} value={billAmount} onChange={(e) => setBillAmount(e.target.value)} required />
                  </div>
                  <Button type="submit" disabled={submitting} className="w-full sm:w-auto h-10">
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Submit Invoice"}
                  </Button>
                </form>
              </div>
            )}

            {order.status === "BillingCompleted" && (
              <div className="rounded-xl border bg-card p-6">
                <h3 className="mb-1 text-lg font-semibold flex items-center gap-2">
                  <IndianRupee className="h-5 w-5 text-primary" /> Record Payment
                </h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Invoice <span className="font-medium">{order.invoice_no}</span> billed at {inr(order.bill_amount ?? 0)}. Record what was received.
                </p>
                <form onSubmit={handlePayment} className="flex flex-col sm:flex-row gap-4 items-end">
                  <div className="flex-1 w-full space-y-2">
                    <label className="text-sm font-medium">Amount Received (₹)</label>
                    <Input type="number" step="0.01" min="0" max={order.bill_amount ?? undefined} placeholder={String(order.bill_amount ?? "")} value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} required />
                  </div>
                  <div className="flex-1 w-full space-y-2">
                    <label className="text-sm font-medium">Payment Date</label>
                    <Input type="date" value={paymentDate} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setPaymentDate(e.target.value)} required />
                  </div>
                  <Button type="submit" disabled={payingSubmit} className="w-full sm:w-auto h-10">
                    {payingSubmit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Confirm Payment"}
                  </Button>
                </form>
              </div>
            )}

            {(order.status === "PaymentReceived" || order.status === "Completed") && (
              <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-sm">
                <div className="flex items-center gap-2 font-semibold text-success">
                  <CheckCircle2 className="h-5 w-5" /> Fully settled
                </div>
                <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                  <div>Invoice: <span className="font-medium text-foreground">{order.invoice_no}</span></div>
                  <div>Billed: <span className="font-medium text-foreground">{inr(order.bill_amount ?? 0)}</span></div>
                  <div>Received: <span className="font-medium text-foreground">{inr(order.amount_received ?? 0)}</span></div>
                  <div>Paid on: <span className="font-medium text-foreground">{order.payment_received_at ? format(new Date(order.payment_received_at), "MMM d, yyyy") : "—"}</span></div>
                </div>
              </div>
            )}
          </>
        }
      />
    </>
  );
}
