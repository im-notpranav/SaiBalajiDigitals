import { createFileRoute } from "@tanstack/react-router";
import { DashboardGuide } from "@/components/dashboard/DashboardBits";
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
      description="Requests that need details submitted come straight to you; the rest, and anything above the Admin limit, arrive after the Admin approves them. Approve, pay to the UPI ID or UPI mobile number given, then close."
      crumbs={[{ label: "Cost Control" }]}
      guide={
        <DashboardGuide>
          <p>
            <strong>Top cards:</strong> what waits on you, what is overdue, what is approved but unpaid, and what went out
            this month. Click a card to list those requests below.
          </p>
          <p>
            <strong>Where requests wait:</strong> click a row to list the requests at that step.
          </p>
          <p>
            <strong>Overdue</strong> counts working days, Sundays not counted. Click any request to open it, then approve,
            pay or close it there.
          </p>
        </DashboardGuide>
      }
    />
  );
}
