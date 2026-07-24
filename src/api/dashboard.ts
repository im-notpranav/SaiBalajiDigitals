import { apiFetch } from "./client";
import type { DashboardData, AuditLogEntry } from "@/types";

export async function fetchDashboard() {
  return apiFetch<DashboardData>("/api/dashboard");
}

export async function fetchAuditLog(page = 1, limit = 50) {
  return apiFetch<{
    logs: AuditLogEntry[];
    pagination: { page: number; limit: number; total: number };
  }>(`/api/admin/audit-log?page=${page}&limit=${limit}`);
}
