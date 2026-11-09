import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAreas, fetchCsmCodes, fetchCsmOptions, fetchFieldStaff } from "@/api/allocation";

/**
 * The lists the job form picks from. They change rarely, so they stay fresh for a few minutes
 * and the form never refetches them while it is opening. Saving through the app still
 * invalidates them, so an edit shows at once.
 */
export const LOOKUP_STALE = 5 * 60_000;

export const areasQuery = {
  queryKey: ["masters", "areas"],
  queryFn: fetchAreas,
  staleTime: LOOKUP_STALE,
} as const;
export const csmCodesQuery = {
  queryKey: ["masters", "csm-codes"],
  queryFn: fetchCsmCodes,
  staleTime: LOOKUP_STALE,
} as const;
export const csmOptionsQuery = {
  queryKey: ["work-jobs", "csm-options"],
  queryFn: fetchCsmOptions,
  staleTime: LOOKUP_STALE,
} as const;
export const fieldStaffQuery = {
  queryKey: ["field-staff"],
  queryFn: fetchFieldStaff,
  staleTime: LOOKUP_STALE,
} as const;

/**
 * Loads the job form's lists in the background as soon as a page that can open the form is
 * shown. Without this the form opens with empty dropdowns that fill in one by one, each
 * re-render landing in the middle of the dialog's opening animation.
 */
export function usePrefetchJobLookups() {
  const qc = useQueryClient();
  useEffect(() => {
    void qc.prefetchQuery(areasQuery);
    void qc.prefetchQuery(csmCodesQuery);
    void qc.prefetchQuery(csmOptionsQuery);
    void qc.prefetchQuery(fieldStaffQuery);
  }, [qc]);
}
