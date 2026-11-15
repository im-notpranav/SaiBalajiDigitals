import { createFileRoute } from "@tanstack/react-router";
import { DailyBoardView } from "@/components/allocation/DailyBoardView";

export const Route = createFileRoute("/_portal/admin/board")({
  head: () => ({ meta: [{ title: "Daily Board — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>): { date?: string } => ({
    date: typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : undefined,
  }),
  component: DailyBoardPage,
});

/** One day at a glance for the managers: every job running, who is free, who is double-booked. */
function DailyBoardPage() {
  const linked = Route.useSearch();
  return (
    <DailyBoardView
      mode="manage"
      initialDate={linked.date}
      crumbs={[{ label: "Work Allocation" }, { label: "Daily Board" }]}
    />
  );
}
