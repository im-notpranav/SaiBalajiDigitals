import { apiFetch, apiDownload, apiClient } from "./client";
import type { CreateOrderInput, Order, ProductionOrder } from "@sb-oms/shared-types";

export interface ImportResult {
  message: string;
  orders_imported?: number;
  line_items_imported?: number;
  errors?: { row: number; message: string }[];
  orders_in_file?: number;
}

export async function downloadImportTemplate() {
  return apiDownload("/orders/import/template");
}

export async function bulkImportOrders(file: File): Promise<ImportResult> {
  const res = await apiClient.post<ImportResult>("/orders/import", file, {
    headers: { "Content-Type": "application/octet-stream" },
  });
  return res.data;
}

export interface OrdersQuery {
  order_no?: string;
  client?: string;
  store?: string;
  status?: string;
  section?: "active" | "completed";
  q?: string;
  page?: number;
  limit?: number;
}

export async function fetchOrders(params: OrdersQuery = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const q = qs.toString();
  const res = await apiFetch<any>(`/orders${q ? `?${q}` : ""}`);
  return {
    orders: res.data || [],
    pagination: { page: res.page, limit: params.limit || 50, total: res.total }
  };
}

export async function fetchProductionOrders() {
  const res = await fetchOrders({ status: "Active", limit: 50 });
  return { orders: res.orders as unknown as ProductionOrder[] };
}

export async function fetchOrder(id: number) {
  const res = await apiFetch<Order>(`/orders/${id}`);
  return { order: res };
}

export async function createOrder(data: CreateOrderInput) {
  const res = await apiFetch<Order>("/orders", {
    method: "POST",
    data,
  });
  return { order: res };
}

export async function updateOrder(id: number, data: CreateOrderInput) {
  const res = await apiFetch<Order>(`/orders/${id}`, {
    method: "PUT",
    data,
  });
  return { order: res };
}

export async function deleteOrder(id: number) {
  return apiFetch<{ ok: boolean }>(`/orders/${id}`, { method: "DELETE" });
}

export async function submitInvoice(id: number, invoice_no: string, bill_amount: number, billing_date: string) {
  const res = await apiFetch<Order>(`/orders/${id}/invoice`, {
    method: "PUT",
    data: { invoice_no, bill_amount, billing_date },
  });
  return { order: res };
}

export async function editBilling(id: number, data: { invoice_no?: string; bill_amount?: number; billing_date?: string }) {
  const res = await apiFetch<Order>(`/orders/${id}/billing`, {
    method: "PATCH",
    data,
  });
  return { order: res };
}

export async function editPaymentDetails(id: number, data: { amount_received?: number; payment_date?: string }) {
  const res = await apiFetch<Order>(`/orders/${id}/payment-edit`, {
    method: "PATCH",
    data,
  });
  return { order: res };
}

export async function getFollowUps(id: number) {
  return apiFetch<any[]>(`/orders/${id}/follow-ups`);
}

export async function createFollowUp(id: number, note: string) {
  return apiFetch<any>(`/orders/${id}/follow-ups`, {
    method: "POST",
    data: { note },
  });
}

export async function closeOrder(id: number, payload: { remarks?: string | null, remarks_other_text?: string | null }) {
  const res = await apiFetch<Order>(`/orders/${id}/close`, {
    method: "PUT",
    data: payload,
  });
  return { order: res };
}

export async function forceCloseOrder(id: number, payload: { remarks: string, remarks_other_text?: string | null }) {
  const res = await apiFetch<Order>(`/orders/${id}/force-close`, {
    method: "PUT",
    data: payload,
  });
  return { order: res };
}

export async function flagOrderItem(orderId: number, itemId: number, is_flagged: boolean, flag_reason?: string | null) {
  const res = await apiFetch<any>(`/orders/${orderId}/items/${itemId}/flag`, {
    method: "PATCH",
    data: { is_flagged, flag_reason },
  });
  return res;
}

export async function setItemLossRemark(orderId: number, itemId: number, remarks: string | null, remarks_other_text?: string | null) {
  const res = await apiFetch<any>(`/orders/${orderId}/items/${itemId}/remark`, {
    method: "PUT",
    data: { remarks, remarks_other_text },
  });
  return res;
}
export async function assignOrderItem(orderId: number, itemId: number, assigned_to: number[]) {
  return apiFetch<any>(`/orders/${orderId}/items/${itemId}/assign`, {
    method: "PATCH",
    data: { assigned_to },
  });
}

export async function markOrderInstalled(id: number) {
  const res = await apiFetch<Order>(`/orders/${id}/install`, { method: "PUT", data: {} });
  return { order: res };
}

export async function recordPayment(id: number, amount_received: number, payment_date: string) {
  const res = await apiFetch<Order>(`/orders/${id}/payment`, {
    method: "PUT",
    data: { amount_received, payment_date },
  });
  return { order: res };
}

export async function completeOrderItem(orderId: number, itemId: number, production_completed: boolean) {
  return apiFetch<any>(`/orders/${orderId}/items/${itemId}/complete`, {
    method: "PATCH",
    data: { production_completed },
  });
}

export async function exportOrders(params: OrdersQuery = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const q = qs.toString();
  return apiDownload(`/orders/export${q ? `?${q}` : ""}`);
}

export interface EmailExportPayload {
  to: string;
  subject?: string;
  message?: string;
  section?: string;
  status?: string;
  q?: string;
}

export async function emailExport(payload: EmailExportPayload) {
  return apiFetch<{ message: string; orders_count: number; items_count: number }>(
    "/orders/export/email",
    { method: "POST", data: payload }
  );
}

export async function getRecentRecipients(q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<string[]>(`/orders/export/recipients${qs}`);
}

export async function downloadLineItemTemplate() {
  return apiDownload("/orders/line-item-template");
}
