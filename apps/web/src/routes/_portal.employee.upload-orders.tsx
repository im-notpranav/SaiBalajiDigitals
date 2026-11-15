import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { BulkOrderUpload } from "@/components/orders/BulkOrderUpload";

export const Route = createFileRoute("/_portal/employee/upload-orders")({
  head: () => ({ meta: [{ title: "Bulk Upload — SB OMS" }] }),
  component: UploadOrders,
});

function UploadOrders() {
  return (
    <>
      <PageHeader
        title="Bulk Upload"
        description="One order per client, from the order sheet."
        crumbs={[{ label: "Employee" }, { label: "Bulk Upload" }]}
      />
      <BulkOrderUpload pickCsm={false} ordersLink="/employee/orders" />
    </>
  );
}
