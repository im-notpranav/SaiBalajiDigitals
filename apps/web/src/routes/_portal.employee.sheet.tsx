import { createFileRoute } from "@tanstack/react-router";
import { SheetView } from "@/components/allocation/SheetView";

/** A CSM's Sheet View: the same team Google Sheet the Operation Manager works from. */
export const Route = createFileRoute("/_portal/employee/sheet")({
  head: () => ({ meta: [{ title: "GS-WAS — SB OMS" }] }),
  component: SheetView,
});
