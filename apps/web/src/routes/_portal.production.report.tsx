import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage, parseReportsSearch } from "@/components/reports/ReportsPage";

export const Route = createFileRoute("/_portal/production/report")({
  head: () => ({ meta: [{ title: "My Printing Report — SB OMS" }] }),
  validateSearch: parseReportsSearch,
  component: MyPrintingReport,
});

/** An operator's own printing: every line they started or finished in the dates picked. */
function MyPrintingReport() {
  const navigate = Route.useNavigate();
  return (
    <ReportsPage
      tabs={["printing"]}
      search={Route.useSearch()}
      onSearch={(search) => navigate({ search, replace: true })}
      title="My Printing Report"
      description="Lines you started or finished, for any dates. Download it as Excel."
      crumbs={[{ label: "Production" }, { label: "My report" }]}
      orderLink={(id) => ({ to: "/production/orders/$id", params: { id: String(id) } })}
    />
  );
}
