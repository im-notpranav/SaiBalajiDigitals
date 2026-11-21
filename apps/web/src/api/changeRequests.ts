import { apiFetch } from "./client";

export type ChangeRequestKind = "LINE_EDIT" | "COMBINE_ORDERS" | "RATE_CHANGE" | "OTHER";
export type ChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface ChangeRequest {
  id: number;
  order_id: number;
  kind: ChangeRequestKind;
  status: ChangeRequestStatus;
  reason: string;
  summary: string;
  other_order_id: number | null;
  requester: { id: number; name: string } | null;
  decider: { id: number; name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  order: { id: number; order_no: string; client_name: string; created_by: number | null; creator_name: string; status: string };
}

/** One row of the admin's queue: a change request, a whole-order Extra / Less, or a line remark. */
export interface QueueRow {
  source: "change" | "adjustment" | "line_remark";
  id: number;
  kind: string;
  label: string;
  status: string;
  order: { id: number; order_no: string; client_name: string; created_by: number | null; creator_name: string };
  reason: string;
  summary: string;
  amount: number | null;
  store_id: number | null;
  requester: { id: number; name: string } | null;
  decider: { id: number; name: string } | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface LineEditLine {
  id?: number;
  store_id?: number;
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  rate: number;
}

export interface LineEditPayload {
  client_name?: string;
  stores?: { id: number; store_name?: string; location?: string }[];
  new_stores?: { store_name: string; location: string; po_number?: string | null; items: Omit<LineEditLine, "id" | "store_id">[] }[];
  items?: LineEditLine[];
  remove_item_ids?: number[];
}

export type NewChangeRequest =
  | { kind: "LINE_EDIT"; reason: string; payload: LineEditPayload }
  | { kind: "COMBINE_ORDERS"; reason: string; other_order_id: number }
  | { kind: "OTHER"; reason: string };

export const createChangeRequest = (orderId: number, data: NewChangeRequest) =>
  apiFetch<{ request: ChangeRequest }>(`/orders/${orderId}/change-requests`, { method: "POST", data });

export const fetchOrderChangeRequests = (orderId: number) =>
  apiFetch<{ requests: ChangeRequest[] }>(`/orders/${orderId}/change-requests`);

export const fetchCombineOptions = (orderId: number) =>
  apiFetch<{ orders: { id: number; order_no: string; date: string; creator_name: string; _count: { stores: number; items: number } }[] }>(
    `/orders/${orderId}/combine-options`,
  );

export const fetchChangeQueue = (status: "pending" | "decided") =>
  apiFetch<{ requests: QueueRow[] }>(`/change-requests?status=${status}`);

export const fetchChangeQueueCount = () => apiFetch<{ pending: number }>("/change-requests/count");

export const approveChangeRequest = (id: number, note?: string) =>
  apiFetch<{ request: ChangeRequest }>(`/change-requests/${id}/approve`, { method: "POST", data: { note: note || null } });

export const rejectChangeRequest = (id: number, note: string) =>
  apiFetch<{ request: ChangeRequest }>(`/change-requests/${id}/reject`, { method: "POST", data: { note } });

export const cancelChangeRequest = (id: number) =>
  apiFetch<{ request: ChangeRequest }>(`/change-requests/${id}/cancel`, { method: "POST" });

/** CSM: ask for Reprint, Sample, Under Warranty, Free of Cost or Other on one saved line. */
export const requestLineRemark = (orderId: number, itemId: number, data: { type: "Reprint" | "Sample" | "UnderWarranty" | "FreeOfCost" | "Other"; reason: string }) =>
  apiFetch<any>(`/orders/${orderId}/items/${itemId}/adjustment-request`, { method: "POST", data });
