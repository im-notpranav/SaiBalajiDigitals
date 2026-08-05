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

export interface CsmStageSummary {
  count: number;
  amount: number;
  qty: number;
}

export interface CsmStageOrder {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  status: string;
  total_amount: number;
  total_qty: number;
  days_in_stage: number;
  stage_since: string;
}

export interface CsmCompletedOrder {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  total_amount: number;
  total_qty: number;
  production_days: number | null;
  installation_days: number | null;
  billing_days: number | null;
  payment_days: number | null;
  total_days: number;
}

export interface CsmDashboardData {
  summary: { total_orders: number; total_amount: number; total_qty: number };
  stages: Record<string, CsmStageSummary>;
  stage_orders: {
    production: CsmStageOrder[];
    installation: CsmStageOrder[];
    billing: CsmStageOrder[];
    payment: CsmStageOrder[];
    completed: CsmCompletedOrder[];
  };
}

export async function fetchCsmDashboard(from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const q = qs.toString();
  return apiFetch<CsmDashboardData>(`/dashboard/csm${q ? `?${q}` : ""}`);
}

export interface ProdTeamStat {
  user_id: number;
  name: string;
  assigned_items: number;
  completed_items: number;
  pending_sft: number;
  completed_sft: number;
  completion_rate: number;
}

export interface ProdPendingItem {
  order_id: number;
  order_no: string;
  client_name: string;
  item_s_no: number;
  media: string;
  total_sft: number;
  assigned_to: Array<{ name: string; completed: boolean }>;
  days_since_assigned: number;
}

export interface ProdManagerDashboardData {
  summary: {
    total_active_orders: number;
    total_sft_pending: number;
    total_sft_completed: number;
    total_items_pending: number;
    total_items_completed: number;
  };
  team_stats: ProdTeamStat[];
  pending_items: ProdPendingItem[];
}

export async function fetchProdManagerDashboard() {
  return apiFetch<ProdManagerDashboardData>("/dashboard/prod-manager");
}

/* ─── Accountant Dashboard ─────────────────────────────────────── */

export interface AcctBillingItem {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  status: string;
  total_amount: number;
  days_waiting: number;
  stage_since: string;
}

export interface AcctPaymentItem {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  invoice_no: string | null;
  bill_amount: number;
  total_amount: number;
  days_since_billed: number;
  billed_at: string;
  is_overdue: boolean;
  creator_name: string;
}

export interface AcctCompletedItem {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  invoice_no: string | null;
  bill_amount: number;
  amount_received: number;
  total_amount: number;
  payment_tat: number | null;
  paid_at: string;
}

export interface AccountantDashboardData {
  summary: {
    billing_queue_count: number;
    billing_queue_amount: number;
    payment_pending_count: number;
    payment_pending_amount: number;
    overdue_count: number;
    overdue_amount: number;
    collected_count: number;
    collected_amount: number;
  };
  billing_queue: AcctBillingItem[];
  payment_queue: AcctPaymentItem[];
  completed: AcctCompletedItem[];
}

export async function fetchAccountantDashboard(from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const q = qs.toString();
  return apiFetch<AccountantDashboardData>(`/dashboard/accountant${q ? `?${q}` : ""}`);
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
