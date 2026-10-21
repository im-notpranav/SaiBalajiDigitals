import { createFileRoute } from "@tanstack/react-router";
import { PaymentReviewQueue } from "@/components/payments/PaymentPages";

export const Route = createFileRoute("/_portal/cost-control/dashboard")({
  head: () => ({ meta: [{ title: "Cost Control — SB OMS" }] }),
  component: CostControlDashboard,
});

/** Home for the Cost Control Manager: approve, pay and close payment requests. */
function CostControlDashboard() {
  return (
    <PaymentReviewQueue
      title="Cost Control"
      description="Requests with bill details come straight to you; requests without bills arrive after the Admin approves them. Approve, pay to the UPI ID or UPI mobile number given, then close."
      crumbs={[{ label: "Cost Control" }]}
    />
  );
}
