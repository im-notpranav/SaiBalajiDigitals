import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchOrder, updateOrder } from "@/api/orders";
import { OrderForm } from "@/components/orders/OrderForm";
import type { CreateOrderInput } from "@sb-oms/shared-types";
import { useAuth } from "@/lib/auth-store";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_portal/employee/edit-order/$id")({
  head: () => ({ meta: [{ title: "Edit Order — SB OMS" }] }),
  component: EditOrderEmployee,
});

function EditOrderEmployee() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const { data: orderData, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const submit = async (payload: CreateOrderInput) => {
    setSaving(true);
    try {
      const res = await updateOrder(Number(id), payload);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.success(`Order ${res.order.order_no} updated`, { description: "Changes saved successfully." });
      navigate({ to: "/employee/orders" });
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        toast.error(`Validation Error: ${data.errors.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ")}`);
      } else {
        toast.error("Failed to update order", { description: err.message });
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  
  if (error || !orderData?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const order = orderData.order;

  // Authorization check (only creator can edit, and only active orders)
  if (order.creator_id !== user?.id) {
    return <div className="p-8 text-destructive font-medium">You are not authorized to edit an order created by someone else.</div>;
  }
  if (order.status !== "Active") {
    return <div className="p-8 text-destructive font-medium">This order cannot be edited because its status is '{order.status}'.</div>;
  }

  return (
    <>
      <PageHeader
        title={`Edit Order ${order.order_no}`}
        description="Update the line items or order details."
        crumbs={[{ label: "Employee" }, { label: "Orders" }, { label: "Edit" }]}
      />

      <OrderForm defaultValues={order} onSubmit={submit} isSubmitting={saving} />
    </>
  );
}
