import { apiFetch } from "./client";
import type { DashboardData, AuditLogEntry } from "@sb-oms/shared-types";

export async function fetchDashboard() {
  return apiFetch<DashboardData>("/dashboard");
}

export async function fetchAdminDashboard() {
  return apiFetch<any>("/dashboard/admin");
}

export async function fetchAuditLog(page = 1, limit = 50) {
  return apiFetch<{
    logs: AuditLogEntry[];
    pagination: { page: number; limit: number; total: number };
  }>(`/admin/audit-log?page=${page}&limit=${limit}`);
}

export async function fetchFinancialYearConfig() {
  return apiFetch<{ year_code: string; last_number: number }>("/admin/financial-year-config");
}

export async function fetchLossReport(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const q = qs.toString();
  return apiFetch<any>(`/admin/loss-report${q ? `?${q}` : ""}`);
}

export async function fetchOverdueReport(days = 5) {
  return apiFetch<{
    threshold: number;
    count: number;
    by_stage: Record<string, number>;
    orders: Array<{
      id: number;
      order_no: string;
      client_name: string;
      store_name: string;
      location: string;
      status: string;
      creator_name: string;
      stage: string;
      stage_since: string;
      days_in_stage: number;
      total_amount: number;
    }>;
  }>(`/admin/overdue?days=${days}`);
}
