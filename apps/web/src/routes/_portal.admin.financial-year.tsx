import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { FinancialYearView } from "@/components/orders/FinancialYearView";

export const Route = createFileRoute("/_portal/admin/financial-year")({
  head: () => ({ meta: [{ title: "Financial Year Config — SB OMS" }] }),
  component: () => (
    <>
      <PageHeader
        title="Financial Year Configuration"
        description="Year suffix and order sequence."
        crumbs={[{ label: "Automated System" }, { label: "Financial Year" }]}
      />
      <FinancialYearView />
    </>
  ),
});
