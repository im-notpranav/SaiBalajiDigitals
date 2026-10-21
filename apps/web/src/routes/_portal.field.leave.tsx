import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyLeave, MyOvertime, RequestLeaveButton } from "@/components/allocation/FieldTimeOff";

export const Route = createFileRoute("/_portal/field/leave")({
  head: () => ({ meta: [{ title: "Leave & Overtime — SB OMS" }] }),
  component: FieldLeave,
});

/** A field worker's leave requests and recorded overtime, on its own page in their nav. */
function FieldLeave() {
  return (
    <>
      <PageHeader
        title="Leave & overtime"
        description="Ask for days off and see the overtime recorded for you."
        crumbs={[{ label: "My Work", to: "/field/dashboard" }, { label: "Leave & overtime" }]}
        actions={<RequestLeaveButton className="h-11 w-full sm:h-10 sm:w-auto" />}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <MyLeave />
        <MyOvertime />
      </div>
    </>
  );
}
