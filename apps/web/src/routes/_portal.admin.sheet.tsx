import { createFileRoute } from "@tanstack/react-router";
import { SheetView } from "@/components/allocation/SheetView";

/** The Admin's and Operation Manager's Sheet View: the team's Google Sheet inside the app. */
export const Route = createFileRoute("/_portal/admin/sheet")({
  head: () => ({ meta: [{ title: "Sheet View — SB OMS" }] }),
  component: SheetView,
});
