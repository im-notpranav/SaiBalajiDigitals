import { createFileRoute } from "@tanstack/react-router";
import { SheetView } from "@/components/allocation/SheetView";

/**
 * Sheet View for every role without a portal page of its own: field staff, Production, the
 * Accountant and the other managers. Not under a role prefix, so any signed-in person may open it.
 */
export const Route = createFileRoute("/_portal/sheet")({
  head: () => ({ meta: [{ title: "GS-WAS — SB OMS" }] }),
  component: SheetView,
});
