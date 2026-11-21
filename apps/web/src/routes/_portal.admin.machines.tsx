import { createFileRoute } from "@tanstack/react-router";
import { MachineSetupPage } from "@/components/production/MachineSetupPage";
import { useAuth } from "@/lib/auth-store";

export const Route = createFileRoute("/_portal/admin/machines")({
  head: () => ({ meta: [{ title: "Machines — SB OMS" }] }),
  component: AdminMachines,
});

/** The super admin keeps machines and line items and gives operators a machine; others look. */
function AdminMachines() {
  const { user } = useAuth();
  const superAdmin = user?.role === "ADMIN" && !!user.is_super_admin;
  return <MachineSetupPage canEditMasters={superAdmin} canEditOperators={superAdmin} />;
}
