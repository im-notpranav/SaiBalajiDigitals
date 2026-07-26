import { apiFetch, apiDownload } from "./client";
import type { CreateOrderInput, Order, ProductionOrder } from "@sb-oms/shared-types";

export interface OrdersQuery {
  order_no?: string;
  client?: string;
  store?: string;
  status?: string;
  section?: "active" | "completed";
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

export async function submitInvoice(id: number, invoice_no: string, bill_amount: number) {
  const res = await apiFetch<Order>(`/orders/${id}/invoice`, {
    method: "PUT",
    data: { invoice_no, bill_amount },
  });
  return { order: res };
}

export async function closeOrder(id: number, payload: { remarks?: string | null, remarks_other_text?: string | null }) {
  const res = await apiFetch<Order>(`/orders/${id}/close`, {
    method: "PUT",
    data: payload,
  });
  return { order: res };
}

export async function forceCloseOrder(id: number) {
  const res = await apiFetch<Order>(`/orders/${id}/force-close`, {
    method: "PUT",
  });
  return { order: res };
}



export async function exportOrders(params: OrdersQuery = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const q = qs.toString();
  return apiDownload(`/orders/export${q ? `?${q}` : ""}`);
}
