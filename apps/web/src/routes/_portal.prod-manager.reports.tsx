import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage, parseReportsSearch } from "@/components/reports/ReportsPage";

export const Route = createFileRoute("/_portal/prod-manager/reports")({
  head: () => ({ meta: [{ title: "Production Reports — SB OMS" }] }),
  validateSearch: parseReportsSearch,
  component: ProductionReports,
});

/** The Production report for the Production Manager: output, holds and unassigned work. */
function ProductionReports() {
  const navigate = Route.useNavigate();
  return (
    <ReportsPage
      tabs={["production"]}
      search={Route.useSearch()}
      onSearch={(search) => navigate({ search, replace: true })}
      title="Production Reports"
      description="Items assigned and finished, by person, with holds and work nobody has yet."
      crumbs={[{ label: "Production Manager" }, { label: "Reports" }]}
    />
  );
}
