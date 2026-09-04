import type { UserRole, RemarkType } from "@sb-oms/shared-types";

export const roleHome: Record<UserRole, string> = {
  ADMIN: "/admin/dashboard",
  OPERATION_MANAGER: "/admin/dashboard",
  CSM: "/employee/dashboard",
  PRODUCTION: "/production/dashboard",
  PRODUCTION_MANAGER: "/prod-manager/dashboard",
  ACCOUNTS: "/accountant/dashboard",
};

export const REMARK_TYPES: { value: RemarkType; label: string }[] = [
  { value: "Reprint", label: "Reprint" },
  { value: "Sample", label: "Sample" },
  { value: "UnderWarranty", label: "Under Warranty" },
  { value: "Revised", label: "Revised" },
  { value: "ExtraAmount", label: "Extra Amount" },
  { value: "LessAmount", label: "Less Amount" },
  { value: "FreeOfCost", label: "Free of Cost" },
  { value: "Other", label: "Other" },
];

export const LOSS_REMARK_TYPES: { value: RemarkType; label: string }[] = [
  { value: "Reprint", label: "Reprint" },
  { value: "Sample", label: "Sample" },
  { value: "UnderWarranty", label: "Under Warranty" },
  { value: "FreeOfCost", label: "Free of Cost" },
  { value: "Other", label: "Other" },
];

export const ORDER_STATUSES = ["Active", "Installed", "Pending", "BillingCompleted", "PaymentReceived", "Completed"] as const;

/**
 * Assignable roles — single source of truth for every role picker.
 * Must stay in sync with the Prisma `Role` enum and `roleEnum` in the API validators.
 */
export const ROLES: { value: string; label: string; description: string }[] = [
  { value: "ADMIN", label: "Administrator", description: "Full access" },
  { value: "OPERATION_MANAGER", label: "Operation Manager", description: "Views everything in the admin portal, cannot change anything" },
  { value: "CSM", label: "Client Service Manager", description: "Creates and manages their own orders" },
  { value: "PRODUCTION_MANAGER", label: "Production Manager", description: "Assigns line items to production teams" },
  { value: "PRODUCTION", label: "Production Team", description: "Completes work assigned to them" },
  { value: "ACCOUNTS", label: "Accountant", description: "Billing and payments" },
];

export const roleLabel = (value?: string | null) =>
  ROLES.find((r) => r.value === value)?.label ?? value ?? "—";

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
  { id: "n3", title: "FY rollover due in 6 days", body: "Financial year FY26 closes on 31 May.", at: "1h ago", read: false, kind: "warning" },
  { id: "n4", title: "Order ORD260998 closed", body: "Closure remark: Delivered.", at: "3h ago", read: true, kind: "success" },
  { id: "n5", title: "Admin override applied", body: "ORD261000 edited by Administrator.", at: "1d ago", read: true, kind: "info" },
];



