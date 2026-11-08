import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { BulkOrderUpload } from "@/components/orders/BulkOrderUpload";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/admin/import")({
  head: () => ({ meta: [{ title: "Bulk Import — SB OMS" }] }),
  component: ImportPage,
});

function ImportPage() {
  const { user } = useAuth();

  if (!user?.is_super_admin) {
    return (
      <>
        <PageHeader title="Bulk Import" crumbs={[{ label: "Automated System" }, { label: "Bulk Import" }]} />
        <div className="surface-panel p-8 flex items-center gap-3 text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Only the super administrator can import orders.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Bulk Import"
        description="Create orders from a sheet and pick each CSM."
        crumbs={[{ label: "Automated System" }, { label: "Bulk Import" }]}
      />
      <BulkOrderUpload pickCsm ordersLink="/admin/orders" />
    </>
  );
}
