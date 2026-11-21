import { apiClient, apiDownload, apiFetch } from "./client";

/**
 * Client for the Master Library: the admin's official client, media and location names.
 * The order forms pick from these lists; anyone who fills in orders can ask for a missing name
 * with requestMasterName().
 */

export type MasterKind = "CLIENT" | "MEDIA" | "LOCATION";
export type Locality = "LOCAL" | "NON_LOCAL";
export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Path segment of each kind's list. */
export const KIND_PATH: Record<MasterKind, "clients" | "media" | "locations"> = {
  CLIENT: "clients",
  MEDIA: "media",
  LOCATION: "locations",
};

export const KIND_LABELS: Record<MasterKind, string> = {
  CLIENT: "Client",
  MEDIA: "Media",
  LOCATION: "Location",
};

export const LOCALITY_LABELS: Record<Locality, string> = {
  LOCAL: "Hyderabad",
  NON_LOCAL: "Non-local",
};

export interface MasterEntry {
  id: number;
  name: string;
  is_active: boolean;
  updated_at: string;
  /** Clients only. */
  code?: string | null;
  short_name?: string | null;
  contact_person?: string | null;
  contact_number?: string | null;
  email?: string | null;
  csm_name?: string | null;
  block_orders?: boolean;
  pending_block_days?: number;
  payment_block_days?: number;
  /** Media only: the machine new lines of it queue on. */
  default_machine_id?: number | null;
  /** Locations only. */
  state?: string | null;
  locality?: Locality;
  district?: string | null;
  needs_confirmation?: boolean;
  /** Records carrying this name: orders (clients), items (media), stores + jobs (locations). */
  usage: number;
  uses: Partial<Record<"orders" | "items" | "stores" | "jobs", number>>;
}

export interface MasterEntryInput {
  name?: string;
  code?: string | null;
  locality?: Locality;
  district?: string | null;
  is_active?: boolean;
  short_name?: string | null;
  contact_person?: string | null;
  contact_number?: string | null;
  email?: string | null;
  csm_name?: string | null;
  default_machine_id?: number | null;
  state?: string | null;
}

export interface NameRequest {
  id: number;
  kind: MasterKind;
  name: string;
  note: string | null;
  status: RequestStatus;
  requested_by: number | null;
  requester: { id: number; name: string } | null;
  decided_by: number | null;
  decider: { id: number; name: string } | null;
  decided_at: string | null;
  reject_reason: string | null;
  final_name: string | null;
  /** What the asker filled in beside the name: contact, machine, locality, state. */
  details?: Record<string, unknown> | null;
  created_at: string;
}

export interface DuplicateGroup {
  kind: MasterKind;
  signature: string;
  members: MasterEntry[];
}

export interface ImportSheetSummary {
  kind: MasterKind;
  sheet: string;
  found: boolean;
  problem: string | null;
  add: number;
  update: number;
  unchanged: number;
  error_count: number;
  errors: { row: number; message: string }[];
  changes: { row: number; name: string; action: "add" | "update"; detail: string }[];
  more_changes: number;
}

const BASE = "/master-library";

// --- Lists -----------------------------------------------------------------

/** Every entry of a kind, archived ones too; the page filters on screen. */
export const fetchMasterEntries = (kind: MasterKind) =>
  apiFetch<{ entries: MasterEntry[] }>(`${BASE}/${KIND_PATH[kind]}`, { params: { status: "all" } });

export const createMasterEntry = (kind: MasterKind, data: MasterEntryInput) =>
  apiFetch<{ entry: MasterEntry }>(`${BASE}/${KIND_PATH[kind]}`, { method: "POST", data });

/** A rename also rewrites the name on every order that carries it; `moved` says how many rows. */
export const updateMasterEntry = (kind: MasterKind, id: number, data: MasterEntryInput) =>
  apiFetch<{ entry: MasterEntry; moved: number }>(`${BASE}/${KIND_PATH[kind]}/${id}`, { method: "PATCH", data });

// --- Duplicates ------------------------------------------------------------

export const fetchDuplicates = () => apiFetch<{ groups: DuplicateGroup[] }>(`${BASE}/duplicates`);

export const mergeMasterEntries = (data: { kind: MasterKind; keep_id: number; merge_ids: number[] }) =>
  apiFetch<{ kept: MasterEntry; merged: number; moved: MasterEntry["uses"] }>(`${BASE}/merge`, { method: "POST", data });

export const markNotSame = (data: { kind: MasterKind; ids: number[] }) =>
  apiFetch<{ ok: true }>(`${BASE}/duplicates/not-same`, { method: "POST", data });

// --- Files -----------------------------------------------------------------

export const downloadMasterTemplate = () => apiDownload(`${BASE}/template`);
export const downloadMasterExport = () => apiDownload(`${BASE}/export`);

const sendFile = async (url: string, file: File) =>
  (
    await apiClient.post<{ sheets: ImportSheetSummary[]; applied?: boolean }>(url, file, {
      headers: { "Content-Type": "application/octet-stream" },
    })
  ).data;

/** Reads the file and saves nothing. */
export const previewMasterImport = (file: File) => sendFile(`${BASE}/import/preview`, file);
/** The same file again, saved. Rows with errors are skipped. */
export const applyMasterImport = (file: File) => sendFile(`${BASE}/import`, file);

// --- Name requests ---------------------------------------------------------

/**
 * Ask the admin to add a missing name. A 409 means the name is already in the list
 * (`existing` holds its spelling) or has already been asked for (`existing_request`).
 */
export const requestMasterName = (data: { kind: MasterKind; name: string; note?: string | null; details?: Record<string, unknown> }) =>
  apiFetch<{ request: NameRequest }>(`${BASE}/requests`, { method: "POST", data });

/** The Admin gets every request; anyone else gets their own. */
export const fetchNameRequests = (status?: RequestStatus) =>
  apiFetch<{ requests: NameRequest[]; pending: number }>(`${BASE}/requests`, { params: status ? { status } : {} });

export const approveNameRequest = (
  id: number,
  data: { name?: string; code?: string | null; locality?: Locality; district?: string | null } & Record<string, unknown>,
) => apiFetch<{ request: NameRequest; entry: Omit<MasterEntry, "usage" | "uses">; existed: boolean }>(`${BASE}/requests/${id}/approve`, { method: "POST", data });

export const rejectNameRequest = (id: number, reason: string) =>
  apiFetch<{ request: NameRequest }>(`${BASE}/requests/${id}/reject`, { method: "POST", data: { reason } });

/** The existing spelling from a 409 on requestMasterName or a save, if the server sent one. */
export function existingNameFrom(err: unknown): string | null {
  const data = (err as { response?: { status?: number; data?: { existing?: string } } })?.response;
  return data?.status === 409 && typeof data.data?.existing === "string" ? data.data.existing : null;
}

/** React Query keys, so the page and the order forms refresh together. */
export const masterKeys = {
  all: ["master-library"] as const,
  entries: (kind: MasterKind) => ["master-library", "entries", kind] as const,
  duplicates: ["master-library", "duplicates"] as const,
  requests: ["master-library", "requests"] as const,
};
