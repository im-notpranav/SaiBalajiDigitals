import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { addStore, fetchOrder, updateOrder, updateOrderDetails, updateStore } from "@/api/orders";
import { toastMissingNames } from "@/api/nameRequests";
import { OrderForm } from "@/components/orders/OrderForm";
import type { CreateOrderInput } from "@sb-oms/shared-types";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_portal/admin/edit-order/$id")({
  head: () => ({ meta: [{ title: "Edit Order — SB OMS" }] }),
  // ?addLine=1 comes from an "Add Line Item" shortcut: open with a blank line ready.
  validateSearch: (search: Record<string, unknown>): { addLine?: boolean } =>
    search.addLine === true || search.addLine === 1 || search.addLine === "1" || search.addLine === "true" ? { addLine: true } : {},
  component: EditOrderAdmin,
});

function EditOrderAdmin() {
  const { id } = Route.useParams();
  const { addLine } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const { data: orderData, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  /**
   * Saved in parts, as the API keeps them apart: the header, each changed store, new stores,
   * then the line items. Sending the whole form to the line-item endpoint is refused there.
   */
  const submit = async (payload: CreateOrderInput) => {
    const order = orderData?.order;
    if (!order) return;
    setSaving(true);
    try {
      const orderId = Number(id);

      const headerPatch: Record<string, unknown> = {};
      if (payload.client_name !== order.client_name) headerPatch.client_name = payload.client_name;
      if ((payload.po_number || "") !== (order.po_number || "")) headerPatch.po_number = payload.po_number || null;
      if ((payload.order_remark || "") !== (order.order_remark || "")) headerPatch.order_remark = payload.order_remark || null;
      if (Object.keys(headerPatch).length > 0) await updateOrderDetails(orderId, headerPatch);

      const existingById = new Map((order.stores ?? []).map((s) => [s.id, s]));
      // A store this form added on an earlier try that failed later on is already saved. Match
      // it by name and location so a retry updates it instead of adding it twice (the API
      // refuses the duplicate).
      const key = (name: string, location: string) => `${name.trim().toLowerCase()}|${location.trim().toLowerCase()}`;
      const formIds = new Set((payload.stores ?? []).map((s) => s.id).filter(Boolean));
      const savedEarlier = new Map(
        (order.stores ?? []).filter((s) => !formIds.has(s.id)).map((s) => [key(s.store_name, s.location), s]),
      );
      const storeIdFor = new Map<number, number>();
      for (const [idx, s] of (payload.stores ?? []).entries()) {
        const prev = s.id ? existingById.get(s.id) : savedEarlier.get(key(s.store_name, s.location));
        if (prev) {
          storeIdFor.set(idx, prev.id);
          const patch: Record<string, unknown> = {};
          if (s.store_name !== prev.store_name) patch.store_name = s.store_name;
          if (s.location !== prev.location) patch.location = s.location;
          if ((s.po_number || "") !== (prev.po_number || "")) patch.po_number = s.po_number || null;
          if (Object.keys(patch).length > 0) await updateStore(orderId, prev.id, patch);
          continue;
        }
        const created = await addStore(orderId, { store_name: s.store_name, location: s.location, po_number: s.po_number || null });
        storeIdFor.set(idx, created.id);
      }

      const items = (payload.stores ?? []).flatMap((s, idx) => s.items.map((it) => ({ ...it, store_id: storeIdFor.get(idx) })));
      if (items.length > 0) await updateOrder(orderId, { items } as unknown as CreateOrderInput);

      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      toast.success(`Order ${order.order_no} updated`, { description: "Changes saved successfully by Admin." });
      navigate({ to: "/admin/orders" });
    } catch (err: any) {
      // Parts saved before the failure stay saved. Reload the order (the form keeps what the
      // admin typed) so the next try compares against what is really stored.
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      // A name not in Master Library: say which, and offer to add it.
      if (toastMissingNames(err, { isAdmin: true })) return;
      toast.error("Failed to update order", { description: friendlyError(err) });
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

  return (
    <>
      <PageHeader
        title={`Edit Order ${order.order_no} (Admin)`}
        description="Edit details or line items."
        crumbs={[{ label: "Automated System" }, { label: "Orders", to: "/admin/orders" }, { label: "Edit" }]}
      />

      <OrderForm defaultValues={order} onSubmit={submit} isSubmitting={saving} userRole={user?.role} startWithNewLine={!!addLine} />
    </>
  );
}
