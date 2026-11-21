import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { fetchOrder, updateOrder, updateOrderDetails, updateStore, addStore } from "@/api/orders";
import { OrderForm } from "@/components/orders/OrderForm";
import { toastMissingNames } from "@/api/nameRequests";
import type { CreateOrderInput } from "@sb-oms/shared-types";
import { useAuth } from "@/lib/auth-store";
import { Loader2 } from "lucide-react";
import { friendlyError } from "@/lib/friendly-error";
import { createChangeRequest, type LineEditPayload } from "@/api/changeRequests";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * What a CSM's edit asks the admin for: client, store names and locations, changed / new /
 * removed lines and new stores. Empty when only PO numbers or the order remark changed.
 */
function essentialChanges(order: any, payload: CreateOrderInput, includeLines: boolean): LineEditPayload {
  const out: LineEditPayload = {};
  if (payload.client_name !== order.client_name) out.client_name = payload.client_name;
  const prevStores = new Map<number, any>((order.stores ?? []).map((s: any) => [s.id, s]));
  const prevItems = new Map<number, any>((order.items ?? []).map((i: any) => [i.id, i]));
  const stores: NonNullable<LineEditPayload["stores"]> = [];
  const newStores: NonNullable<LineEditPayload["new_stores"]> = [];
  const items: NonNullable<LineEditPayload["items"]> = [];
  const kept = new Set<number>();
  const plain = (it: any) => ({ media: it.media, width_inches: it.width_inches, height_inches: it.height_inches, qty: it.qty, rate: it.rate });
  for (const s of payload.stores ?? []) {
    if (!s.id) {
      if (includeLines) newStores.push({ store_name: s.store_name, location: s.location, po_number: s.po_number || null, items: s.items.map(plain) });
      continue;
    }
    const prev = prevStores.get(s.id);
    if (prev && (s.store_name !== prev.store_name || s.location !== prev.location)) {
      stores.push({ id: s.id, store_name: s.store_name, location: s.location });
    }
    for (const it of s.items) {
      if (it.id) kept.add(it.id);
      if (!includeLines) continue;
      const was = it.id ? prevItems.get(it.id) : null;
      const changed =
        !was ||
        was.media !== it.media ||
        Number(was.width_inches) !== it.width_inches ||
        Number(was.height_inches) !== it.height_inches ||
        Number(was.qty) !== it.qty ||
        Number(was.rate) !== it.rate;
      if (changed) items.push({ ...(it.id ? { id: it.id } : { store_id: s.id }), ...plain(it) });
    }
  }
  if (stores.length) out.stores = stores;
  if (newStores.length) out.new_stores = newStores;
  if (items.length) out.items = items;
  if (includeLines) {
    const removed = [...prevItems.keys()].filter((itemId) => !kept.has(itemId));
    if (removed.length) out.remove_item_ids = removed;
  }
  return out;
}

function summarise(p: LineEditPayload | null): string {
  if (!p) return "";
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (p.client_name) parts.push("client");
  if (p.stores?.length) parts.push(plural(p.stores.length, "store rename"));
  if (p.new_stores?.length) parts.push(plural(p.new_stores.length, "new store"));
  const changed = p.items?.filter((i) => i.id).length ?? 0;
  const added = (p.items?.length ?? 0) - changed;
  if (changed) parts.push(plural(changed, "changed line"));
  if (added) parts.push(plural(added, "new line"));
  if (p.remove_item_ids?.length) parts.push(plural(p.remove_item_ids.length, "removed line"));
  return parts.length ? `Changes: ${parts.join(", ")}.` : "";
}

export const Route = createFileRoute("/_portal/employee/edit-order/$id")({
  head: () => ({ meta: [{ title: "Edit Order — SB OMS" }] }),
  // ?addLine=1 comes from an "Add Line Item" shortcut: open with a blank line ready.
  validateSearch: (search: Record<string, unknown>): { addLine?: boolean } =>
    search.addLine === true || search.addLine === 1 || search.addLine === "1" || search.addLine === "true" ? { addLine: true } : {},
  component: EditOrderEmployee,
});

/** Header fields stay editable until the order is settled; line items freeze at billing. */
const HEADER_EDITABLE = ["Active", "Installed", "BillingCompleted", "Pending"];
const LINE_ITEMS_EDITABLE = ["Active", "Installed"];

function EditOrderEmployee() {
  const { id } = Route.useParams();
  const { addLine } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<LineEditPayload | null>(null);
  const [reason, setReason] = useState("");

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
  // A saved order's essentials change only with the admin's approval.
  const requestMode = !!order && !isAdmin && (order.items?.length ?? 0) > 0;

  const done = (message: string, description: string) => {
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: ["order", id] });
    queryClient.invalidateQueries({ queryKey: ["change-requests"] });
    toast.success(message, { description });
    navigate({ to: "/employee/orders/$id", params: { id } });
  };

  /** Request mode: PO numbers and the order remark save now; the rest waits for approval. */
  const submitRequest = async (payload: CreateOrderInput) => {
    if (!order) return;
    setSaving(true);
    try {
      const orderId = Number(id);
      const headerPatch: Record<string, unknown> = {};
      if ((payload.po_number || "") !== (order.po_number || "")) headerPatch.po_number = payload.po_number || null;
      if ((payload.order_remark || "") !== (order.order_remark || "")) headerPatch.order_remark = payload.order_remark || null;
      if (Object.keys(headerPatch).length > 0) await updateOrderDetails(orderId, headerPatch);
      let storePo = 0;
      const prevStores = new Map((order.stores ?? []).map((s) => [s.id, s]));
      for (const s of payload.stores ?? []) {
        const prev = s.id ? prevStores.get(s.id) : null;
        if (prev && (s.po_number || "") !== (prev.po_number || "")) {
          await updateStore(orderId, s.id!, { po_number: s.po_number || null });
          storePo++;
        }
      }
      const ask = essentialChanges(order, payload, !lineItemsLocked);
      if (Object.keys(ask).length === 0) {
        if (Object.keys(headerPatch).length === 0 && storePo === 0) toast.info("Nothing changed.");
        else done(`Order ${order.order_no} updated`, "PO and remark saved.");
        return;
      }
      setReason("");
      setPendingRequest(ask);
    } catch (err: any) {
      toast.error("Failed to update order", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const sendRequest = async () => {
    if (!order || !pendingRequest) return;
    if (reason.trim().length < 3) return void toast.error("Give a reason for the change.");
    setSaving(true);
    try {
      await createChangeRequest(Number(id), { kind: "LINE_EDIT", reason: reason.trim(), payload: pendingRequest });
      setPendingRequest(null);
      done("Sent for approval", "The admin approves the change before it applies.");
    } catch (err: any) {
      if (toastMissingNames(err, { isAdmin })) return;
      toast.error("Not sent", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const submit = async (payload: CreateOrderInput) => {
    if (!order) return;
    if (requestMode) return submitRequest(payload);
    setSaving(true);
    try {
      const orderId = Number(id);

      // 1. Order header — client name and the job PO.
      const headerPatch: Record<string, unknown> = {};
      if (payload.client_name !== order.client_name) headerPatch.client_name = payload.client_name;
      if ((payload.po_number || "") !== (order.po_number || "")) headerPatch.po_number = payload.po_number || null;
      if ((payload.order_remark || "") !== (order.order_remark || "")) headerPatch.order_remark = payload.order_remark || null;
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
      // A name not in Master Library: say which, and offer to ask the admin for it.
      if (toastMissingNames(err, { isAdmin })) return;
      toast.error("Failed to update order", { description: friendlyError(err) });
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
        startWithNewLine={!!addLine}
        requestMode={requestMode}
      />
      <Dialog open={!!pendingRequest} onOpenChange={(o) => !o && setPendingRequest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send for approval</DialogTitle>
            <DialogDescription>
              {summarise(pendingRequest)} The order stays as it is until the admin approves.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-reason">Reason *</Label>
            <Textarea id="edit-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change needed?" maxLength={1000} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRequest(null)}>
              Back to the form
            </Button>
            <Button onClick={sendRequest} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
