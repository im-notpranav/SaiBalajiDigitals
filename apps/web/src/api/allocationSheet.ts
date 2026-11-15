import { apiFetch } from "./client";

/** Work Allocation's Sheet View: the team's Google Sheet, shown inside the app. */
export interface AllocationSheet {
  /** The link as the Admin saved it, for "Open in Google Sheets". */
  url: string;
  /** The same sheet's edit page without Google's menus, for the frame. */
  embed_url: string | null;
}

export const fetchAllocationSheet = () => apiFetch<AllocationSheet>("/allocation-sheet");

export const updateAllocationSheet = (url: string) =>
  apiFetch<AllocationSheet>("/allocation-sheet", { method: "PUT", data: { url } });

/** The same check the API makes, so the Save button can say no before asking. */
export const isGoogleSheetUrl = (v: string) =>
  v.length <= 500 &&
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,100}(?:[/?#][^\s<>"'`\\]*)?$/.test(
    v,
  );
