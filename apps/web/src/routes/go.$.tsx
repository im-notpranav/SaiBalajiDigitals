import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { FIELD_ROLES, roleHome, useAuth, type UserRole } from "@/lib/auth-store";

/**
 * Landing page for the "Open in app" button on WhatsApp messages: /go/pr/28, /go/job/12/30
 * (job 12 on order 30), /go/order/30. One link goes to many people, so where it leads is
 * worked out here from the reader's role. Moving on inside the app (not a page reload)
 * keeps the portal from bouncing to the dashboard while sign-in is still loading.
 */
export const Route = createFileRoute("/go/$")({
  head: () => ({ meta: [{ title: "Opening… — SB OMS" }] }),
  component: GoLink,
});

/** The order page each role can open, if any. */
function orderPage(role: UserRole, orderId: string): string | null {
  if (role === "CSM") return `/employee/orders/${orderId}`;
  if (role === "ADMIN" || role === "OPERATION_MANAGER") return `/admin/orders/${orderId}`;
  if (role === "PRODUCTION") return `/production/orders/${orderId}`;
  return null;
}

/** Where a link leads for someone in this role; their home page when it means nothing to them. */
export function destinationFor(role: UserRole, link: string): string {
  const [kind, a, b] = link.split("/");
  const id = (s?: string) => (s && /^\d+$/.test(s) ? s : null);
  const isField = FIELD_ROLES.includes(role);

  if (kind === "pr" && id(a)) {
    const open = `?open=${a}`;
    if (role === "CSM") return `/employee/payments${open}`;
    if (isField) return `/field/payments${open}`;
    if (role === "ADMIN") return `/admin/payments${open}`;
    if (role === "COST_CONTROL_MANAGER") return `/cost-control/dashboard${open}`;
  }
  if (kind === "job" && id(a)) {
    if (isField) return "/field/dashboard";
    if (role === "ADMIN" || role === "OPERATION_MANAGER") return "/admin/jobs";
    const page = id(b) && orderPage(role, b!);
    if (page) return page;
  }
  if (kind === "order" && id(a)) {
    const page = orderPage(role, a!);
    if (page) return page;
  }
  return roleHome[role];
}

function GoLink() {
  const { _splat } = Route.useParams();
  const link = String(_splat ?? "").replace(/^\/+|\/+$/g, "");
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (user) {
      navigate({ href: destinationFor(user.role, link), replace: true });
      return;
    }
    navigate({ href: `/login?redirect=${encodeURIComponent(`/go/${link}`)}`, replace: true });
  }, [user, isLoading, link, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Opening…
    </div>
  );
}
