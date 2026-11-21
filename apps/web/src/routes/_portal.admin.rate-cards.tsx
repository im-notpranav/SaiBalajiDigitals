import { createFileRoute } from "@tanstack/react-router";
import { RateCardPage } from "@/components/rates/RateCardPage";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/admin/rate-cards")({
  head: () => ({ meta: [{ title: "Rate Cards — SB OMS" }] }),
  component: AdminRateCards,
});

/** The admin keeps the rate cards; the Operation Manager may look. */
function AdminRateCards() {
  const { user } = useAuth();
  return <RateCardPage mode={user?.role === "ADMIN" ? "admin" : "view"} />;
}
