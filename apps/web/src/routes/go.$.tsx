import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { destinationFor } from "@/lib/use-order-nav";

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
