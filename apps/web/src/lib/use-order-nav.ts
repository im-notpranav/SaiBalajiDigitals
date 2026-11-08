import { useNavigate } from "@tanstack/react-router";
import { roleHome, useAuth, type UserRole } from "@/lib/auth-store";

/** Roles with no order page of their own: a notification about an order takes them home. */
const NO_ORDER_PAGE: UserRole[] = ["COST_CONTROL_MANAGER", "PASTER", "HELPER", "DRIVER"];

/** What the link on a notification about an order should say for this person. */
export const orderLinkLabel = (role?: UserRole) =>
  role && NO_ORDER_PAGE.includes(role) ? "Open →" : "View order →";

/** This person's page listing all their notifications. Every role's sits beside their home page. */
export const notificationsPath = (role: UserRole) => roleHome[role].replace(/\/[^/]+$/, "/notifications");

/**
 * Navigate to an order's detail page using the route that matches the current user's role.
 * (Each role has its own order-detail surface; accountants use the billing view.)
 */
export function useGoToOrder() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (orderId: number) => {
    const params = { id: String(orderId) };
    switch (user?.role) {
      case "ADMIN":
      case "OPERATION_MANAGER":
        navigate({ to: "/admin/orders/$id", params });
        break;
      case "CSM":
        navigate({ to: "/employee/orders/$id", params });
        break;
      case "PRODUCTION":
        navigate({ to: "/production/orders/$id", params });
        break;
      case "ACCOUNTS":
        navigate({ to: "/accountant/billing/$id", params });
        break;
      case "PRODUCTION_MANAGER":
        navigate({ to: "/prod-manager/assign", search: { order: orderId } });
        break;
      default:
        if (user) navigate({ to: roleHome[user.role] });
        break;
    }
  };
}
