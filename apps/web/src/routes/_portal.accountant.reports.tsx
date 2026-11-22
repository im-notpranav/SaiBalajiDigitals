import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage, parseReportsSearch } from "@/components/reports/ReportsPage";

export const Route = createFileRoute("/_portal/accountant/reports")({
  head: () => ({ meta: [{ title: "Financial Reports — SB OMS" }] }),
  validateSearch: parseReportsSearch,
  component: Reports,
});

/** The Money report: billed, received, outstanding and not yet billed. Rows open the billing page. */
function Reports() {
  const navigate = Route.useNavigate();
  return (
    <ReportsPage
      tabs={["money", "turnover"]}
      search={Route.useSearch()}
      onSearch={(search) => navigate({ search, replace: true })}
      title="Financial Reports"
      description="Billed, received, outstanding and not yet billed, for any dates."
      crumbs={[{ label: "Accountant" }, { label: "Reports" }]}
      orderLink={(id) => ({ to: "/accountant/billing/$id", params: { id: String(id) } })}
    />
  );
}
