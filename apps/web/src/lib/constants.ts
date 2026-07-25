import type { UserRole, RemarkType, ClosureRemarkType, ProductionRemarkType } from "@sb-oms/shared-types";

export const roleHome: Record<UserRole, string> = {
  employee: "/employee/dashboard",
  production: "/production/dashboard",
  accountant: "/accountant/dashboard",
  admin: "/admin/dashboard",
};

export const REMARK_TYPES: { value: RemarkType; label: string }[] = [
  { value: "Reprint", label: "Reprint" },
  { value: "Sample", label: "Sample" },
  { value: "UnderWarranty", label: "Under Warranty" },
  { value: "Revised", label: "Revised" },
  { value: "ExtraAmount", label: "Extra Amount" },
  { value: "LessAmount", label: "Less Amount" },
  { value: "FreeOfCost", label: "Free of Cost" },
];

export const ORDER_STATUSES = ["Active", "Pending", "Completed"] as const;

export function remarkLabel(value: RemarkType | null | undefined): string {
  if (!value) return "—";
  return REMARK_TYPES.find((r) => r.value === value)?.label ?? value;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  kind: "info" | "success" | "warning";
}

export const NOTIFICATIONS: Notification[] = [
  { id: "n1", title: "Order ORD261004 billed", body: "Your order has been marked as billed by accounts.", at: "2m ago", read: false, kind: "success" },
  { id: "n2", title: "New order in production queue", body: "ORD261012 needs stage advancement.", at: "18m ago", read: false, kind: "info" },
  { id: "n3", title: "FY rollover due in 6 days", body: "Financial year FY26 closes on 30 Apr.", at: "1h ago", read: false, kind: "warning" },
  { id: "n4", title: "Order ORD260998 closed", body: "Closure remark: Delivered.", at: "3h ago", read: true, kind: "success" },
  { id: "n5", title: "Admin override applied", body: "ORD261000 edited by Administrator.", at: "1d ago", read: true, kind: "info" },
];

export const REVENUE_TREND = [
  { month: "Nov", revenue: 1240000, orders: 78 },
  { month: "Dec", revenue: 1580000, orders: 92 },
  { month: "Jan", revenue: 1420000, orders: 85 },
  { month: "Feb", revenue: 1780000, orders: 104 },
  { month: "Mar", revenue: 2140000, orders: 121 },
  { month: "Apr", revenue: 1890000, orders: 112 },
];

export const CLOSURE_REMARK_TYPES: { value: ClosureRemarkType; label: string }[] = [
  { value: "Delivered", label: "Delivered" },
  { value: "CustomerCancelled", label: "Customer Cancelled" },
  { value: "DuplicateOrder", label: "Duplicate Order" },
  { value: "PaymentCleared", label: "Payment Cleared" },
  { value: "CustomReason", label: "Custom Reason" },
];

export const PRODUCTION_REMARK_TYPES: { value: ProductionRemarkType; label: string }[] = [
  { value: "Clarification", label: "Clarification" },
  { value: "InternalNote", label: "Internal Note" },
  { value: "CustomerUpdate", label: "Customer Update" },
  { value: "ProductionHandoff", label: "Production Handoff" },
  { value: "QCHold", label: "QC Hold" },
];
