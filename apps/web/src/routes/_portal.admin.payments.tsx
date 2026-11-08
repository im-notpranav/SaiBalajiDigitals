import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { PaymentReviewQueue } from "@/components/payments/PaymentPages";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/admin/payments")({
  head: () => ({ meta: [{ title: "Payment Requests — SB OMS" }] }),
  component: AdminPayments,
});

/** The Admin approves no-bill requests before they reach Cost Control. */
function AdminPayments() {
  const { user } = useAuth();
  // The admin section is shared with the Operation Manager, who has no part in payments.
  if (user?.role !== "ADMIN") {
    return (
      <PageHeader
        title="Payment Requests"
        description="Handled by the Admin and Cost Control."
        crumbs={[{ label: "Payment Request" }, { label: "Requests" }]}
      />
    );
  }
  return (
    <PaymentReviewQueue
      title="Payment Requests"
      description="Requests waiting for your approval."
      crumbs={[{ label: "Payment Request" }, { label: "Requests" }]}
    />
  );
}
