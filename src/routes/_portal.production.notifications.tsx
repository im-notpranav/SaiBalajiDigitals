import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { NOTIFICATIONS } from "@/lib/mock-data";

export const Route = createFileRoute("/_portal/production/notifications")({
  head: () => ({ meta: [{ title: "Notifications — SB OMS" }] }),
  component: () => (
    <>
      <PageHeader title="Notifications" crumbs={[{ label: "Production" }, { label: "Notifications" }]} />
      <div className="surface-panel divide-y">
        {NOTIFICATIONS.map((n) => (
          <div key={n.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{n.title}</div>
              <div className="text-xs text-muted-foreground">{n.at}</div>
            </div>
            <div className="text-sm text-muted-foreground">{n.body}</div>
          </div>
        ))}
      </div>
    </>
  ),
});
