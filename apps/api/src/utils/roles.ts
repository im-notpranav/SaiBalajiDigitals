/**
 * Role groups. Routes authorise against these instead of repeating role lists, so a new
 * role cannot silently gain access to a surface by being left off a list.
 */

/** Roles that use the order management system. Field staff and the Cost Control Manager
 *  are deliberately absent: they reach order details only through their own portals. */
export const OMS_ROLES = [
  "ADMIN",
  "OPERATION_MANAGER",
  "CSM",
  "ACCOUNTS",
  "PRODUCTION",
  "PRODUCTION_MANAGER",
] as const;

/** Pasters, Helpers and Drivers: field staff who log in to see their own work. */
export const FIELD_ROLES = ["PASTER", "HELPER", "DRIVER"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export const isFieldRole = (role: string | null | undefined): role is FieldRole =>
  (FIELD_ROLES as readonly string[]).includes(role ?? "");

/** Who runs the work-allocation portal: staff, masters, and (from Phase C) jobs. */
export const ALLOCATION_MANAGER_ROLES = ["ADMIN", "OPERATION_MANAGER"] as const;
