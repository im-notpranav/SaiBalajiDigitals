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
      tabs={["printing", "production"]}
      search={Route.useSearch()}
      onSearch={(search) => navigate({ search, replace: true })}
      title="Production Reports"
      description="Line-by-line printing for any dates, for everyone or one operator; items assigned and finished, holds and unassigned work."
      crumbs={[{ label: "Production Manager" }, { label: "Reports" }]}
    />
  );
}
