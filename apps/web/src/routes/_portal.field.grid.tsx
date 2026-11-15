import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { WeeklyGridView } from "@/components/allocation/WeeklyGridView";

export const Route = createFileRoute("/_portal/field/grid")({
  head: () => ({ meta: [{ title: "Weekly Grid — SB OMS" }] }),
  component: FieldWeeklyGridPage,
});

/**
 * A Paster, Helper or Driver's Weekly Grid: only their own jobs and leave, by date, read-only.
 * The API sends only their own row, with nobody else's name. Starting and completing a job
 * stay on My Work.
 */
function FieldWeeklyGridPage() {
  return (
    <>
      <PageHeader
        title="Weekly Grid"
        description="Your jobs and leave, by date."
        crumbs={[{ label: "My Work" }, { label: "Weekly Grid" }]}
      />
      <WeeklyGridView mode="field" />
    </>
  );
}
