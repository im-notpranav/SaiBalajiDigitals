import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { FinancialYearView } from "@/components/orders/FinancialYearView";

export const Route = createFileRoute("/_portal/accountant/financial-year")({
  head: () => ({ meta: [{ title: "Financial Year — SB OMS" }] }),
  component: () => (
    <>
      <PageHeader
        title="Financial Year"
        description="The current financial year."
        crumbs={[{ label: "Accountant" }, { label: "Financial Year" }]}
      />
      <FinancialYearView />
    </>
  ),
});
