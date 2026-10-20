import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

export const Route = createFileRoute("/_portal/cost-control/dashboard")({
  head: () => ({ meta: [{ title: "Cost Control — SB OMS" }] }),
  component: CostControlDashboard,
});

/** Home for the Cost Control Manager. The payment-request queue lands here. */
function CostControlDashboard() {
  return (
    <>
      <PageHeader
        title="Cost Control"
        description="Payment requests routed to you, waiting for review, payment or closure."
        crumbs={[{ label: "Cost Control" }]}
      />
      <div className="surface-panel flex flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Wallet className="h-6 w-6" />
        </div>
        <div className="text-base font-semibold">No payment requests yet</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          Requests with bill details come straight to you. Requests without bills come here after the Admin approves them.
        </p>
      </div>
    </>
  );
}
