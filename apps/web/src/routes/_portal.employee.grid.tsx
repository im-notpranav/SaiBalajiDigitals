import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { WeeklyGridView } from "@/components/allocation/WeeklyGridView";

export const Route = createFileRoute("/_portal/employee/grid")({
  head: () => ({ meta: [{ title: "Weekly Grid — SB OMS" }] }),
  component: CsmWeeklyGridPage,
});

/**
 * The Weekly Grid for a CSM: every CSM's field work, read-only. He can update the work details
 * or order of his own jobs from a job's details; the team and dates stay with the Operations
 * Manager. The API sends this view only to CSMs.
 */
function CsmWeeklyGridPage() {
  return (
    <>
      <PageHeader
        title="Weekly Grid"
        description="All field work by date. You can update your own jobs."
        crumbs={[{ label: "Field Jobs" }, { label: "Weekly Grid" }]}
      />
      <WeeklyGridView mode="csm" />
    </>
  );
}
