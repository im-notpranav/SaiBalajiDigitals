import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { BulkOrderUpload } from "@/components/orders/BulkOrderUpload";

export const Route = createFileRoute("/_portal/employee/upload-orders")({
  head: () => ({ meta: [{ title: "Upload Orders — SB OMS" }] }),
  component: UploadOrders,
});

function UploadOrders() {
  return (
    <>
      <PageHeader
        title="Upload Orders"
        description="One order per client, from the order sheet."
        crumbs={[{ label: "Employee" }, { label: "Upload Orders" }]}
      />
      <BulkOrderUpload pickCsm={false} ordersLink="/employee/orders" />
    </>
  );
}
