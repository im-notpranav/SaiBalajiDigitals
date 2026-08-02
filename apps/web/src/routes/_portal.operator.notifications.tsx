import { createFileRoute } from "@tanstack/react-router";
import { NotificationsList } from "@/components/notifications/NotificationsList";

export const Route = createFileRoute("/_portal/operator/notifications")({
  head: () => ({ meta: [{ title: "Notifications — SB OMS" }] }),
  component: () => <NotificationsList crumbs={[{ label: "Operator" }, { label: "Notifications" }]} />,
});
