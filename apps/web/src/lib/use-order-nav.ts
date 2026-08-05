import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";

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
        navigate({ to: "/prod-manager/assign" });
        break;
      default:
        break;
    }
  };
}
