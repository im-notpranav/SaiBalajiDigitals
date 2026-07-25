import { apiFetch } from "./client";
import type { DashboardData, AuditLogEntry } from "@sb-oms/shared-types";

export async function fetchDashboard() {
  return apiFetch<DashboardData>("/dashboard");
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
