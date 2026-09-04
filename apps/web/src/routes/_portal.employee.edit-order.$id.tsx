import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchOrder, updateOrder, updateOrderDetails, updateStore, addStore } from "@/api/orders";
import { OrderForm } from "@/components/orders/OrderForm";
import type { CreateOrderInput } from "@sb-oms/shared-types";
import { useAuth } from "@/lib/auth-store";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_portal/employee/edit-order/$id")({
  head: () => ({ meta: [{ title: "Edit Order — SB OMS" }] }),
  component: EditOrderEmployee,
});

/** Header fields stay editable until the order is settled; line items freeze at billing. */
const HEADER_EDITABLE = ["Active", "Installed", "BillingCompleted", "Pending"];
const LINE_ITEMS_EDITABLE = ["Active", "Installed"];

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

  const order = orderData?.order;
  const isAdmin = user?.role === "ADMIN";
  const isCreator = order?.created_by === user?.id;
  // Line items stay creator-restricted; header fields do not, so a colleague can enter a
  // PO while the CSM who raised the order is away.
  const lineItemsLocked = !order || !LINE_ITEMS_EDITABLE.includes(order.status) || (!isAdmin && !isCreator);

  const submit = async (payload: CreateOrderInput) => {
    if (!order) return;
    setSaving(true);
    try {
      const orderId = Number(id);

      // 1. Order header — client name and the job PO.
      const headerPatch: Record<string, unknown> = {};
      if (payload.client_name !== order.client_name) headerPatch.client_name = payload.client_name;
      if ((payload.po_number || "") !== (order.po_number || "")) headerPatch.po_number = payload.po_number || null;
      if (Object.keys(headerPatch).length > 0) await updateOrderDetails(orderId, headerPatch);

      // 2. Existing stores — name, location, store PO.
      const existingById = new Map((order.stores ?? []).map((s) => [s.id, s]));
      for (const s of payload.stores ?? []) {
        if (!s.id) continue;
        const prev = existingById.get(s.id);
        if (!prev) continue;
        const patch: Record<string, unknown> = {};
        if (s.store_name !== prev.store_name) patch.store_name = s.store_name;
        if (s.location !== prev.location) patch.location = s.location;
        if ((s.po_number || "") !== (prev.po_number || "")) patch.po_number = s.po_number || null;
        if (Object.keys(patch).length > 0) await updateStore(orderId, s.id, patch);
      }

      // 3. Newly added stores, and the items that belong to them.
      const storeIdFor = new Map<number, number>();
      for (const [idx, s] of (payload.stores ?? []).entries()) {
        if (s.id) { storeIdFor.set(idx, s.id); continue; }
        if (lineItemsLocked) continue; // a new store means new items
        const created = await addStore(orderId, {
          store_name: s.store_name, location: s.location, po_number: s.po_number || null,
        });
        storeIdFor.set(idx, created.id);
      }

      // 4. Line items, each tagged with the store it belongs to.
      if (!lineItemsLocked) {
        const items = (payload.stores ?? []).flatMap((s, idx) =>
          s.items.map((it) => ({ ...it, store_id: storeIdFor.get(idx) }))
        );
        if (items.length > 0) await updateOrder(orderId, { items } as unknown as CreateOrderInput);
      }

      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.success(`Order ${order.order_no} updated`, { description: "Changes saved successfully." });
      navigate({ to: "/employee/orders" });
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        toast.error(`Validation Error: ${data.errors.join(", ")}`);
      } else {
        toast.error("Failed to update order", { description: data?.message || err.message });
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }

  if (error || !order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  // Only a fully settled order is closed to editing outright — a PO usually arrives after
  // the invoice, so billing alone no longer locks the whole page.
  if (!isAdmin && !HEADER_EDITABLE.includes(order.status)) {
    return (
      <div className="p-8 text-destructive font-medium">
        This order is settled (status: '{order.status}') and can only be changed by an administrator.
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit Order ${order.order_no}`}
        description={
          lineItemsLocked
            ? "Line items are frozen. Client, store, location and PO numbers can still be corrected."
            : "Update the stores, line items or order details."
        }
        crumbs={[{ label: "Employee" }, { label: "Orders" }, { label: "Edit" }]}
      />

      <OrderForm
        defaultValues={order}
        onSubmit={submit}
        isSubmitting={saving}
        userRole={user?.role}
        lineItemsLocked={lineItemsLocked}
      />
    </>
  );
}
