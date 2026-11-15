import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@sb-oms/shared-types";
import { markNotificationRead } from "@/api/notifications";
import { FIELD_ROLES, roleHome, useAuth, type UserRole } from "@/lib/auth-store";

/** This person's page listing all their notifications. Every role's sits beside their home page. */
export const notificationsPath = (role: UserRole) => roleHome[role].replace(/\/[^/]+$/, "/notifications");

/** The order page each role can open, if any. */
function orderPage(role: UserRole, orderId: string): string | null {
  if (role === "CSM") return `/employee/orders/${orderId}`;
  if (role === "ADMIN" || role === "OPERATION_MANAGER") return `/admin/orders/${orderId}`;
  if (role === "PRODUCTION") return `/production/orders/${orderId}`;
  if (role === "ACCOUNTS") return `/accountant/billing/${orderId}`;
  if (role === "PRODUCTION_MANAGER") return `/prod-manager/assign?order=${orderId}`;
  return null;
}

/** Each role's payment requests page. */
function paymentsPage(role: UserRole): string | null {
  if (role === "CSM") return "/employee/payments";
  if (FIELD_ROLES.includes(role)) return "/field/payments";
  if (role === "ADMIN") return "/admin/payments";
  if (role === "COST_CONTROL_MANAGER") return "/cost-control/dashboard";
  return null;
}

/**
 * Where a link leads for someone in this role; their home page when it means nothing to them.
 * Links are the WhatsApp "Open in app" form (/go/pr/28, /go/job/12/30 for job 12 on order 30,
 * /go/order/30) and what a notification stores: also "payments", "leave", "overtime" and
 * "library/requests". One link can reach many people, so the page is worked out per role.
 */
export function destinationFor(role: UserRole, link: string): string {
  const [kind, a, b] = link.split("/");
  const id = (s?: string) => (s && /^\d+$/.test(s) ? s : null);
  const isField = FIELD_ROLES.includes(role);
  const isManager = role === "ADMIN" || role === "OPERATION_MANAGER";

  if (kind === "pr" && id(a)) {
    const page = paymentsPage(role);
    if (page) return `${page}?open=${a}`;
  }
  if (kind === "payments") {
    const page = paymentsPage(role);
    if (page) return page;
  }
  if (kind === "job" && id(a)) {
    if (isField) return "/field/dashboard";
    if (isManager) return "/admin/jobs";
    const page = id(b) && orderPage(role, b!);
    if (page) return page;
    if (role === "CSM") return "/employee/jobs";
  }
  if (kind === "order" && id(a)) {
    const page = orderPage(role, a!);
    if (page) return page;
  }
  if (kind === "leave") {
    if (isManager) return "/admin/leave";
    if (isField) return "/field/leave";
  }
  if (kind === "overtime") {
    if (isManager) return "/admin/overtime";
    if (isField) return "/field/leave";
  }
  if (kind === "library" && isManager) return "/admin/master-library?tab=requests";
  return roleHome[role];
}

/** The link a notification carries; older ones only name an order. */
const linkOf = (n: Pick<Notification, "link" | "order_id">) => n.link ?? (n.order_id ? `order/${n.order_id}` : null);

/** Where clicking a notification goes for this person, or null when it leads nowhere. */
export function notificationHref(role: UserRole | undefined, n: Pick<Notification, "link" | "order_id">): string | null {
  const link = linkOf(n);
  return role && link ? destinationFor(role, link) : null;
}

/** The words on a notification's link, by what it opens. */
export function notificationLinkLabel(n: Pick<Notification, "link" | "order_id">, href: string, role?: UserRole): string {
  if (role && href === roleHome[role]) return "Open →";
  const kind = linkOf(n)?.split("/")[0];
  if (kind === "order") return "View order →";
  if (kind === "pr") return "Open request →";
  if (kind === "payments") return "Open payment requests →";
  if (kind === "job") return href.includes("/orders") ? "View order →" : "Open jobs →";
  if (kind === "leave") return "Open leave →";
  if (kind === "overtime") return "Open overtime →";
  if (kind === "library") return "Open requests →";
  return "Open →";
}

/** Opening a notification: it is marked read, then the page it is about opens. */
export function useOpenNotification() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return async (n: Notification) => {
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      } catch {
        /* non-blocking — still navigate */
      }
    }
    const href = notificationHref(user?.role, n);
    if (href) navigate({ href });
  };
}
