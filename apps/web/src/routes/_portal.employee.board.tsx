import { createFileRoute } from "@tanstack/react-router";
import { DailyBoardView } from "@/components/allocation/DailyBoardView";

export const Route = createFileRoute("/_portal/employee/board")({
  head: () => ({ meta: [{ title: "Daily Board — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>): { date?: string } => ({
    date: typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? search.date : undefined,
  }),
  component: CsmDailyBoardPage,
});

/**
 * The Daily Board for a CSM: every job that day and who is free, read-only. He opens his own
 * jobs to update their work details or order. The API sends this view only to CSMs.
 */
function CsmDailyBoardPage() {
  const linked = Route.useSearch();
  return (
    <DailyBoardView
      mode="csm"
      initialDate={linked.date}
      crumbs={[{ label: "Field Jobs" }, { label: "Daily Board" }]}
    />
  );
}
