import { apiFetch, apiDownload } from "./client";
import type { CreateOrderInput, Order, ProductionOrder } from "@/types";

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
  return apiFetch<{ orders: Order[]; pagination: { page: number; limit: number; total: number } }>(
    `/api/orders${q ? `?${q}` : ""}`,
  );
}

export async function fetchProductionOrders() {
  const res = await fetchOrders({ status: "Active", limit: 50 });
  return { orders: res.orders as unknown as ProductionOrder[] };
}

export async function fetchOrder(id: number) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`);
}

export async function createOrder(data: CreateOrderInput) {
  return apiFetch<{ order: Order }>("/api/orders", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateOrder(id: number, data: CreateOrderInput) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteOrder(id: number) {
  return apiFetch<{ ok: boolean }>(`/api/orders/${id}`, { method: "DELETE" });
}

export async function submitInvoice(id: number, invoice_no: string, bill_amount: number) {
  return apiFetch<{ order: Order; matched: boolean; difference: number }>(`/api/orders/${id}/invoice`, {
    method: "PUT",
    body: JSON.stringify({ invoice_no, bill_amount }),
  });
}

export async function closeOrder(id: number, remarks?: string | null) {
  return apiFetch<{ order: Order }>(`/api/orders/${id}/close`, {
    method: "PUT",
    body: JSON.stringify({ remarks }),
  });
}

export async function exportOrders(params: OrdersQuery = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, String(v));
  }
  const q = qs.toString();
  return apiDownload(`/api/orders/export${q ? `?${q}` : ""}`);
}
