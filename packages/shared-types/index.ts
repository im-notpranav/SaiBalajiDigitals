export type UserRole = "employee" | "production" | "accountant" | "admin";

export type OrderStatus = "Active" | "Pending" | "Completed";

export type RemarkType =
  | "Reprint"
  | "Sample"
  | "UnderWarranty"
  | "Revised"
  | "ExtraAmount"
  | "LessAmount"
  | "FreeOfCost"
  | "Other";



export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  email?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  is_super_admin?: boolean;
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
  remarks_other_text?: string | null;
  remarks_set_at?: string | null;
  remarks_set_by?: number | null;
  remarks_confirmed?: boolean;
  remarks_confirmed_at?: string | null;
  remarks_confirmed_by?: number | null;
  is_flagged?: boolean;
  flag_reason?: string | null;
  flagged_at?: string | null;
  flagged_by?: number | null;
  assigned_to?: number | null;
  assigned_at?: string | null;
  assigned_by?: number | null;
  production_completed?: boolean;
  production_completed_at?: string | null;
  production_completed_by?: number | null;
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
  remarks?: RemarkType | null;
  remarks_other_text?: string | null;
  invoice_no?: string | null;
  bill_amount?: number | null;
  created_by?: number;
  creator_name?: string;
  items: OrderItem[];
  total_amount?: number;
  loss_amount?: number;
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
  remarks?: RemarkType | null;
  remarks_other_text?: string | null;
  items: Array<{
    id?: number;
    media: string;
    width_inches: number;
    height_inches: number;
    qty: number;
    rate: number;
    remarks?: RemarkType | null;
    remarks_other_text?: string | null;
  }>;
}

export interface Notification {
  id: number | string;
  user_id: number;
  title: string;
  body: string;
  kind: "info" | "success" | "warning" | string;
  read: boolean;
  order_id?: number | null;
  created_at: string;
}
