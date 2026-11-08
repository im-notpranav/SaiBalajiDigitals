import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { createOrder } from "@/api/orders";
import { OrderForm } from "@/components/orders/OrderForm";
import type { CreateOrderInput } from "@sb-oms/shared-types";

export const Route = createFileRoute("/_portal/employee/new-order")({
  head: () => ({ meta: [{ title: "New Order — SB OMS" }] }),
  component: NewOrder,
});

function NewOrder() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const submit = async (payload: CreateOrderInput) => {
    setSaving(true);
    try {
      const res = await createOrder(payload);
      toast.success(`Order ${res.order.order_no} created`, { description: "Order was saved successfully." });
      navigate({ to: "/employee/orders" });
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        toast.error(`Validation Error: ${data.errors.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ")}`);
      } else {
        toast.error("Failed to create order", { description: err.message });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New Order"
        description="The order number is given on submit."
        crumbs={[{ label: "Employee" }, { label: "New Order" }]}
        actions={
          <Button asChild variant="outline">
            <Link to="/employee/upload-orders">
              <Upload className="mr-2 h-4 w-4" /> Upload Orders
            </Link>
          </Button>
        }
      />

      <OrderForm onSubmit={submit} isSubmitting={saving} />
    </>
  );
}
