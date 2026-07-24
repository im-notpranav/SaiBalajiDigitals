import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Info, AlertTriangle, BellOff } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { NOTIFICATIONS } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/employee/notifications")({
  head: () => ({ meta: [{ title: "Notifications — SB OMS" }] }),
  component: NotificationsPage,
});

function iconFor(kind: string) {
  if (kind === "success") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (kind === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <Info className="h-4 w-4 text-info" />;
}

function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Real-time status updates scoped to your orders."
        crumbs={[{ label: "Notifications" }]}
        actions={
          <Button variant="outline" className="rounded-xl">
            <BellOff className="mr-2 h-4 w-4" /> Mark all read
          </Button>
        }
      />
      <div className="surface-panel divide-y">
        {NOTIFICATIONS.map((n) => (
          <div
            key={n.id}
            className={cn("flex items-start gap-3 p-4 transition hover:bg-muted/40", !n.read && "bg-primary/5")}
          >
            <div className="mt-0.5 rounded-lg border bg-card p-2">{iconFor(n.kind)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate font-semibold">{n.title}</div>
                {!n.read && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">New</span>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{n.at}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
