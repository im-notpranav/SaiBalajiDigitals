import { apiFetch } from "./client";

/**
 * Order-number blocks: a client with an order open too long (default 90 days) or a bill unpaid
 * too long (default 120 days) takes no new order from a CSM until the admin allows one.
 */

export interface BlockReason {
  kind: "PENDING_ORDER" | "UNPAID_INVOICE";
  order_id: number;
  order_no: string;
  invoice_no?: string;
  since: string;
  days: number;
  limit: number;
}

export interface BlockState {
  client_name: string;
  blocked: boolean;
  reasons: BlockReason[];
  settings: { block_orders: boolean; pending_block_days: number; payment_block_days: number } | null;
  exception: { id: number; decided_at: string | null; expires_at: string | null } | null;
  pending_request: { id: number; created_at: string } | null;
}

export type ExceptionStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface BlockException {
  id: number;
  client_name: string;
  reason: string;
  status: ExceptionStatus;
  requester: { id: number; name: string; username: string } | null;
  decider: { id: number; name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
  used_at: string | null;
  used_order_id: number | null;
  used_order_no: string | null;
  expired: boolean;
  created_at: string;
  reasons?: BlockReason[];
}

export interface ClientBlockSettings {
  id: number;
  name: string;
  code: string | null;
  block_orders: boolean;
  pending_block_days: number;
  payment_block_days: number;
}

const BASE = "/order-blocks";

export const checkOrderBlock = (client: string) => apiFetch<BlockState>(`${BASE}/check?client=${encodeURIComponent(client)}`);

export const requestBlockException = (client_name: string, reason: string) =>
  apiFetch<{ exception: BlockException }>(`${BASE}/exceptions`, { method: "POST", data: { client_name, reason } });

export const withdrawBlockException = (id: number) => apiFetch<{ ok: true }>(`${BASE}/exceptions/${id}`, { method: "DELETE" });

export const fetchBlockExceptions = (status?: ExceptionStatus) =>
  apiFetch<{ exceptions: BlockException[] }>(`${BASE}/exceptions${status ? `?status=${status}` : ""}`);

export const fetchBlockExceptionCount = () => apiFetch<{ pending: number }>(`${BASE}/exceptions/count`);

export const approveBlockException = (id: number, note?: string) =>
  apiFetch<{ exception: BlockException }>(`${BASE}/exceptions/${id}/approve`, { method: "POST", data: { note: note || null } });

export const rejectBlockException = (id: number, note: string) =>
  apiFetch<{ exception: BlockException }>(`${BASE}/exceptions/${id}/reject`, { method: "POST", data: { note } });

export const fetchClientBlockSettings = () => apiFetch<{ clients: ClientBlockSettings[] }>(`${BASE}/clients`);

export const updateClientBlockSettings = (id: number, data: Partial<Pick<ClientBlockSettings, "block_orders" | "pending_block_days" | "payment_block_days">>) =>
  apiFetch<{ client: ClientBlockSettings }>(`${BASE}/clients/${id}`, { method: "PUT", data });

export const blockReasonText = (r: BlockReason) =>
  r.kind === "PENDING_ORDER"
    ? `${r.order_no} still open after ${r.days} days (limit ${r.limit})`
    : `Invoice ${r.invoice_no} on ${r.order_no} unpaid after ${r.days} days (limit ${r.limit})`;
