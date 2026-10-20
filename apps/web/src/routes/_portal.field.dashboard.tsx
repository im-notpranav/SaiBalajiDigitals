import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, Phone } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/lib/auth-store";
import { roleLabel } from "@/lib/constants";

export const Route = createFileRoute("/_portal/field/dashboard")({
  head: () => ({ meta: [{ title: "My Work — SB OMS" }] }),
  component: FieldDashboard,
});

/**
 * Home for Pasters, Helpers and Drivers. Built for a phone first: this is where their
 * assigned jobs will be listed with Started / Completed buttons once jobs exist.
 */
function FieldDashboard() {
  const { user } = useAuth();
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <>
      <PageHeader title={`Hi ${firstName}`} description={roleLabel(user?.role)} crumbs={[{ label: "My Work" }]} />

      <div className="surface-panel flex flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ClipboardList className="h-6 w-6" />
        </div>
        <div className="text-base font-semibold">No jobs assigned to you yet</div>
        <p className="max-w-sm text-sm text-muted-foreground">
          When the Operations Manager assigns you work, it shows up here with the CSM, location, team and vehicle.
        </p>
      </div>

      {!user?.phone && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Phone className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>Your WhatsApp number is missing. Add it on your Profile page so you receive job alerts.</span>
        </div>
      )}
    </>
  );
}
