import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage, parseReportsSearch } from "@/components/reports/ReportsPage";

export const Route = createFileRoute("/_portal/cost-control/reports")({
  head: () => ({ meta: [{ title: "Payment Reports — SB OMS" }] }),
  validateSearch: parseReportsSearch,
  component: CostControlReports,
});

/** The Payment requests report for the Cost Control Manager. */
function CostControlReports() {
  const navigate = Route.useNavigate();
  return (
    <ReportsPage
      tabs={["payments"]}
      search={Route.useSearch()}
      onSearch={(search) => navigate({ search, replace: true })}
      title="Payment Reports"
      description="Requests raised and paid, what is still open, and where the money went."
      crumbs={[{ label: "Cost Control" }, { label: "Reports" }]}
    />
  );
}
