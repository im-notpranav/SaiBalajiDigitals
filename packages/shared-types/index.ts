export type UserRole = "employee" | "production" | "accountant" | "admin";

export type OrderStatus = "Active" | "Pending" | "Completed";

export type RemarkType =
  | "Reprint"
  | "Sample"
  | "UnderWarranty"
  | "Revised"
  | "ExtraAmount"
  | "LessAmount"
  | "FreeOfCost";

export type ClosureRemarkType =
  | "Delivered"
  | "CustomerCancelled"
  | "DuplicateOrder"
  | "PaymentCleared"
  | "CustomReason";

export type ProductionRemarkType =
  | "Clarification"
  | "InternalNote"
  | "CustomerUpdate"
  | "ProductionHandoff"
  | "QCHold";

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  is_active?: boolean;
  last_login_at?: string | null;
  initials: string;
}

export interface OrderItem {
  id?: number;
  s_no?: number;
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  total_sft: number;
  rate?: number;
  amount?: number;
  remarks?: RemarkType | null;
}

export interface Order {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  location: string;
  date?: string;
  po_number?: string | null;
  status: OrderStatus;
  closure_remark_type?: ClosureRemarkType | null;
  closure_remark_text?: string | null;
  production_remark_type?: ProductionRemarkType | null;
  production_remark_text?: string | null;
  invoice_no?: string | null;
  bill_amount?: number | null;
  created_by?: number;
  creator_name?: string;
  items: OrderItem[];
  total_amount?: number;
  created_at?: string;
}

export interface ProductionOrder {
  id: number;
  order_no: string;
  client_name: string;
  store_name: string;
  location: string;
  status: OrderStatus;
  items: Array<{
    s_no: number;
    media: string;
    width_inches: number;
    height_inches: number;
    qty: number;
    total_sft: number;
  }>;
}

export interface AppUser extends AuthUser {
  created_at?: string;
}

export interface AuditLogEntry {
  id: string;
  table_name: string;
  record_id: number;
  action: string;
  changed_by: number | null;
  old_data: unknown;
  new_data: unknown;
  changed_at: string;
}

export interface DashboardData {
  total_orders: number;
  total_revenue: number;
  active_orders: number;
  pending_orders: number;
  completed_orders: number;
  revenue_by_client: Array<{ client: string; revenue: number }>;
  revenue_trend: Array<{ month: string; revenue: number }>;
  orders_by_status: Record<OrderStatus, number>;
  employee_leaderboard: Array<{ name: string; completed: number; revenue: number }>;
  avg_turnaround_days: number;
}

export interface CreateOrderInput {
  client_name: string;
  store_name: string;
  location: string;
  date: string;
  po_number?: string | null;
  items: Array<{
    media: string;
    width_inches: number;
    height_inches: number;
    qty: number;
    rate: number;
    remarks?: RemarkType | null;
  }>;
}
