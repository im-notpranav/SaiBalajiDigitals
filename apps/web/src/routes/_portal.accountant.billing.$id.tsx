import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder, submitInvoice } from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Receipt } from "lucide-react";

export const Route = createFileRoute("/_portal/accountant/billing/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailAccountant,
});

function OrderDetailAccountant() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [invoiceNo, setInvoiceNo] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        actions={
          order.status === "Pending" ? (
            <div className="rounded-xl border bg-card p-6">
              <h3 className="mb-4 text-lg font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" /> Record Invoice
              </h3>
              <form onSubmit={handleInvoice} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full space-y-2">
                  <label className="text-sm font-medium">Invoice Number</label>
                  <Input 
                    placeholder="e.g. INV-2024-001" 
                    value={invoiceNo} 
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    required
                  />
                </div>
                <div className="flex-1 w-full space-y-2">
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
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto h-10">
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Submit Invoice"}
                </Button>
              </form>
            </div>
          ) : null
        }
      />
    </>
  );
}
