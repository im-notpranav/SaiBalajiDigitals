import { createFileRoute } from "@tanstack/react-router";
import { MachineSetupPage } from "@/components/production/MachineSetupPage";

export const Route = createFileRoute("/_portal/prod-manager/machines")({
  head: () => ({ meta: [{ title: "Machines — SB OMS" }] }),
  component: () => <MachineSetupPage canEditMasters={false} canEditOperators />,
});
