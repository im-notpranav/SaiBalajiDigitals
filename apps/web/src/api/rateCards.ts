import { apiClient, apiDownload, apiFetch } from "./client";

export type RateCardStatus = "PENDING" | "ACTIVE" | "REJECTED";

export interface RateCard {
  id: number;
  client: { id: number; name: string; code: string | null };
  media: { id: number; name: string };
  rate: number;
  effective_from: string;
  status: RateCardStatus;
  note: string | null;
  creator: { id: number; name: string } | null;
  decider: { id: number; name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  /** The entry that prices orders today for its client and line item. */
  in_force?: boolean;
}

export interface RateImportResult {
  applied: boolean;
  rows: { row: number; client: string; media: string; rate: number; effective_from: string }[];
  row_count: number;
  errors: { row: number; message: string }[];
  error_count: number;
  added: number;
  updated: number;
}

const BASE = "/rate-cards";

export const fetchRateCards = (params: { client?: string; status?: RateCardStatus | "" } = {}) => {
  const q = new URLSearchParams();
  if (params.client) q.set("client", params.client);
  if (params.status) q.set("status", params.status);
  const s = q.toString();
  return apiFetch<{ rates: RateCard[] }>(`${BASE}${s ? `?${s}` : ""}`);
};

export const fetchRateCardCount = () => apiFetch<{ pending: number }>(`${BASE}/count`);

/** The rates an order line takes for this client on this day, by line item. */
export const lookupRates = (client: string, date?: string) =>
  apiFetch<{ rates: { media: string; rate: number; effective_from: string }[] }>(
    `${BASE}/lookup?client=${encodeURIComponent(client)}${date ? `&date=${date}` : ""}`,
  );

export const createRateCard = (data: { client_name: string; media: string; rate: number; effective_from?: string; note?: string | null }) =>
  apiFetch<{ rate: RateCard }>(BASE, { method: "POST", data });

export const updateRateCard = (id: number, data: { rate?: number; effective_from?: string; note?: string | null }) =>
  apiFetch<{ rate: RateCard }>(`${BASE}/${id}`, { method: "PATCH", data });

export const deleteRateCard = (id: number) => apiFetch<{ ok: true }>(`${BASE}/${id}`, { method: "DELETE" });

export const approveRateCard = (id: number, data: { rate?: number; note?: string | null } = {}) =>
  apiFetch<{ rate: RateCard }>(`${BASE}/${id}/approve`, { method: "POST", data });

export const rejectRateCard = (id: number, note: string) =>
  apiFetch<{ rate: RateCard }>(`${BASE}/${id}/reject`, { method: "POST", data: { note } });

export const downloadRateTemplate = () => apiDownload(`${BASE}/template`);
export const downloadRateExport = (client?: string) =>
  apiDownload(`${BASE}/export${client ? `?client=${encodeURIComponent(client)}` : ""}`);

export const importRateCards = async (file: File, preview: boolean) =>
  (
    await apiClient.post<RateImportResult>(`${BASE}/import${preview ? "?preview=1" : ""}`, file, {
      headers: { "Content-Type": "application/octet-stream" },
    })
  ).data;
