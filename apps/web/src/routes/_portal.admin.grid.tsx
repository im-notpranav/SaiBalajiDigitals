import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { WeeklyGridView } from "@/components/allocation/WeeklyGridView";

export const Route = createFileRoute("/_portal/admin/grid")({
  head: () => ({ meta: [{ title: "Weekly Grid — SB OMS" }] }),
  component: WeeklyGridPage,
});

/** The managers' Weekly Grid: pick a date to see and assign its work. */
function WeeklyGridPage() {
  return (
    <>
      <PageHeader
        title="Weekly Grid"
        description="Pick a date to assign its work."
        crumbs={[{ label: "Work Allocation" }, { label: "Weekly Grid" }]}
      />
      <WeeklyGridView mode="manage" />
    </>
  );
}
