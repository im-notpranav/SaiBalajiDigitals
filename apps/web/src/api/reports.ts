import { apiDownload, apiFetch } from "./client";

/** The Reports page's tabs, as the API names them. */
export type ReportTab = "orders" | "money" | "csm" | "production" | "allocation" | "payments" | "masters" | "system" | "printing" | "turnover" | "delay";

export interface ReportQuery {
  /** YYYY-MM-DD, India time, included. */
  from?: string;
  to?: string;
  /** Only orders this user created. */
  csm?: number;
  /** Printing: only lines this operator worked. */
  operator?: number;
  /** Only orders for this client. */
  client?: string;
}

export interface ReportOptions {
  csms: { id: number; name: string; role: string; active: boolean }[];
  clients: string[];
}

const qs = (q: ReportQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** One tab's figures. Each tab's shape is read by its own component. */
export function fetchReport<T = any>(tab: ReportTab, q: ReportQuery) {
  return apiFetch<T>(`/reports/${tab}${qs(q)}`);
}

/** The same figures as an Excel workbook, one sheet per table. */
export function exportReport(tab: ReportTab, q: ReportQuery) {
  return apiDownload(`/reports/${tab}/export${qs(q)}`);
}

export function fetchReportOptions() {
  return apiFetch<ReportOptions>("/reports/options");
}
