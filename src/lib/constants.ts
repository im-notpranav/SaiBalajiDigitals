import type { UserRole, RemarkType } from "@/types";

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
