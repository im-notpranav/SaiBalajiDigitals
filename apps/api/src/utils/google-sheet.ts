/**
 * The team's Google Sheet link, shown inside the app as Work Allocation's Sheet View.
 *
 * Only a Google Sheets link may be saved: the page puts it in a frame and a button, so a link
 * to any other site would put that site inside the app. Pure, so the unit tests can check it.
 */

/** https://docs.google.com/spreadsheets/d/<id>, then anything after the id (/edit, ?usp, #gid). */
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#][^\s<>"'`\\]*)?$/;

export const MAX_SHEET_URL_LENGTH = 500;

export function isGoogleSheetUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_SHEET_URL_LENGTH && SHEET_URL.test(v);
}

/**
 * The address the frame opens: the sheet's edit page without Google's menus and toolbar
 * (rm=minimal), so anyone signed in to Google with access can still type into it. A tab picked
 * in the saved link (#gid=…) is kept.
 */
export function sheetEmbedUrl(url: string): string | null {
  const id = SHEET_URL.exec(url)?.[1];
  if (!id) return null;
  const gid = /[?#&]gid=(\d+)/.exec(url)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/edit?rm=minimal${gid ? `#gid=${gid}` : ""}`;
}
