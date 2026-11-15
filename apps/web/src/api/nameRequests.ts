import { toast } from "sonner";
import { apiFetch } from "./client";
import type { AreaLocality } from "./allocation";
import type { BulkPreview } from "./orders";

/**
 * Master Library pick-lists and name requests. Only the admin adds client, media and location
 * names; everyone else picks from these lists, and asks the admin for a name that is missing.
 */

export type MasterKind = "CLIENT" | "MEDIA" | "LOCATION";

export const MASTER_KIND_LABELS: Record<MasterKind, string> = {
  CLIENT: "Client",
  MEDIA: "Media",
  LOCATION: "Location",
};

export interface MissingName {
  kind: MasterKind;
  name: string;
}

/* ─── Pick-lists: active names only, A to Z ──────────────────────── */

export interface PickOption {
  name: string;
  /** A short note shown beside the name, such as "Non-local". */
  hint?: string;
}

const q = (search: string) => encodeURIComponent(search.trim());

export async function searchClientNames(search: string): Promise<PickOption[]> {
  const res = await apiFetch<{ clients: string[] }>(`/clients?q=${q(search)}`);
  return res.clients.map((name) => ({ name }));
}

export async function searchMediaNames(search: string): Promise<PickOption[]> {
  const res = await apiFetch<{ media: string[] }>(`/media?q=${q(search)}`);
  return res.media.map((name) => ({ name }));
}

export async function searchLocationNames(search: string): Promise<PickOption[]> {
  const res = await apiFetch<{ locations: { name: string; locality: AreaLocality }[] }>(`/masters/locations?q=${q(search)}`);
  return res.locations.map((l) => ({ name: l.name, hint: l.locality === "NON_LOCAL" ? "Non-local" : undefined }));
}

export const searchNames: Record<MasterKind, (search: string) => Promise<PickOption[]>> = {
  CLIENT: searchClientNames,
  MEDIA: searchMediaNames,
  LOCATION: searchLocationNames,
};

/* ─── Asking the admin for a missing name ────────────────────────── */

export type NameRequestResult =
  | { status: "sent" }
  /** Already in the list (`existing` is its spelling), or someone has already asked. */
  | { status: "refused"; message: string; existing?: string };

/** POST /master-library/requests. A 409 is an answer, not a failure, so it comes back as one. */
export async function requestMasterName(data: { kind: MasterKind; name: string; note?: string }): Promise<NameRequestResult> {
  try {
    await apiFetch("/master-library/requests", { method: "POST", data });
    return { status: "sent" };
  } catch (err: any) {
    const res = err?.response;
    if (res?.status === 409) {
      return { status: "refused", message: res.data?.message || "This name has already been asked for.", existing: res.data?.existing };
    }
    throw err;
  }
}

export const REQUEST_SENT = "Request sent to admin. You'll be told when it's added.";

/** The names a save was refused over, when the server says they are not in Master Library. */
export function missingNamesOf(err: unknown): MissingName[] {
  const missing = (err as any)?.response?.data?.missing;
  return Array.isArray(missing) ? missing.filter((m) => m && typeof m.name === "string" && m.kind in MASTER_KIND_LABELS) : [];
}

/** Asks the admin for each name, then says how it went in one toast. */
export async function requestNames(names: MissingName[]) {
  let sent = 0;
  const refused: string[] = [];
  for (const n of names) {
    try {
      const res = await requestMasterName({ kind: n.kind, name: n.name });
      if (res.status === "sent") sent++;
      else refused.push(res.message);
    } catch {
      refused.push(`Could not ask for '${n.name}'. Please try again.`);
    }
  }
  if (sent > 0) toast.success(REQUEST_SENT, refused.length ? { description: refused.join(" ") } : undefined);
  else if (refused.length) toast.info(refused.join(" "));
  return { sent, refused };
}

/**
 * When a save was refused over names missing from Master Library, says so with a button that
 * asks the admin for them (or, for the admin, opens Master Library in a new tab so the form is
 * kept). Returns false for any other error, which the caller reports itself.
 */
export function toastMissingNames(err: unknown, opts: { isAdmin?: boolean } = {}): boolean {
  const missing = missingNamesOf(err);
  if (missing.length === 0) return false;
  toast.error((err as any)?.response?.data?.message ?? "Some names are not in Master Library.", {
    duration: 12000,
    action: opts.isAdmin
      ? { label: "Open Master Library", onClick: () => void window.open("/admin/master-library", "_blank", "noopener") }
      : { label: missing.length === 1 ? "Request it" : "Request them", onClick: () => void requestNames(missing) },
  });
  return true;
}

/* ─── Upload preview: rows left out over missing names ───────────── */

export interface RejectedRow {
  row: number;
  missing: MissingName[];
}

export interface MissingNameGroup extends MissingName {
  rows: number[];
}

/** The upload preview, with the rows the server left out because a name is not in Master Library. */
export interface CheckedBulkPreview extends BulkPreview {
  rejected_rows?: RejectedRow[];
  rejected_count?: number;
  missing_names?: MissingNameGroup[];
}
