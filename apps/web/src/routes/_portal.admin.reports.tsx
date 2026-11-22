import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage, parseReportsSearch } from "@/components/reports/ReportsPage";

export const Route = createFileRoute("/_portal/admin/reports")({
  head: () => ({ meta: [{ title: "Reports — SB OMS" }] }),
  validateSearch: parseReportsSearch,
  component: AdminReports,
});

/** Every report, for the admin and the Operation Manager. Rows open the order. */
function AdminReports() {
  const navigate = Route.useNavigate();
  return (
    <ReportsPage
      tabs={["orders", "money", "turnover", "csm", "production", "printing", "delay", "allocation", "payments", "masters", "system"]}
      search={Route.useSearch()}
      onSearch={(search) => navigate({ search, replace: true })}
      title="Reports"
      description="Orders, money, people, field work, payment requests and the Master Library, for any dates."
      crumbs={[{ label: "Automated System" }, { label: "Reports" }]}
      orderLink={(id) => ({ to: "/admin/orders/$id", params: { id: String(id) } })}
    />
  );
}
