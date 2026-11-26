import { apiClient, apiFetch } from "./client";
import type { AppUser, AuthUser } from "@sb-oms/shared-types";
import type { UserRole } from "@sb-oms/shared-types";

/** Where to load a user's picture from: stored paths are relative to the API. */
export const photoSrc = (url?: string | null) =>
  url ? (url.startsWith("/") ? `${apiClient.defaults.baseURL}${url}` : url) : undefined;

/** A row on the Users page: the account plus the CSM codes linked to it, in code order. */
export type UserRow = AppUser & { csmCodes?: Array<{ id: number; code: string; is_active: boolean }>; emp_code?: string | null };

/** Every account except permanently deleted ones. */
export async function fetchUsers() {
  return apiFetch<{ users: UserRow[] }>("/users");
}

export async function fetchProductionStaff() {
  return apiFetch<{ users: Array<{ id: number; name: string; username: string }> }>("/users/production-staff");
}

export async function checkUsername(username: string) {
  return apiFetch<{ available: boolean }>(`/users/check?username=${encodeURIComponent(username)}`);
}

export async function createUser(data: {
  name: string;
  username: string;
  password: string;
  role: UserRole;
  phone: string;
  email: string;
  /** Required when the role is CSM; separate from the employee code. */
  csm_code?: string | null;
}) {
  const res = await apiFetch<AuthUser>("/users", {
    method: "POST",
    data,
  });
  return { user: res };
}

/** Delete permanently, keeping history (super admin only). */
export async function deleteUser(id: number) {
  return apiFetch<{ message: string }>(`/users/${id}`, { method: "DELETE" });
}

export async function updateMe(data: {
  name?: string;
  whatsapp_opt_out?: boolean;
  current_password?: string;
  new_password?: string;
}) {
  const res = await apiFetch<AuthUser>("/users/me", {
    method: "PUT",
    data,
  });
  return { user: res };
}

/** The super admin sets a person's picture, already shrunk by the browser. */
export const uploadUserPhoto = (id: number, picture: Blob) =>
  apiFetch<{ id: number; photo_url: string | null }>(`/users/${id}/photo`, {
    method: "POST",
    data: picture,
    headers: { "Content-Type": "application/octet-stream" },
  });

export const removeUserPhoto = (id: number) =>
  apiFetch<{ id: number; photo_url: string | null }>(`/users/${id}/photo`, { method: "DELETE" });

/** `warning` comes back on deactivation when the person still has open work to reassign. */
export async function toggleUserStatus(id: number, is_active: boolean) {
  const res = await apiFetch<AuthUser & { warning?: string }>(`/users/${id}/status`, {
    method: "PUT",
    data: { is_active },
  });
  return { user: res };
}

/** Admin-initiated password reset for another account (super-admin only). */
export async function resetUserPassword(id: number, new_password: string) {
  return apiFetch<{ message: string }>(`/users/${id}/password`, {
    method: "PUT",
    data: { new_password },
  });
}

export async function updateUser(
  id: number,
  data: {
    name: string;
    username: string;
    role: string;
    phone: string;
    email: string;
    whatsapp_opt_out?: boolean;
    /** A CSM code to give this CSM; leave out to keep their codes as they are. */
    csm_code?: string | null;
    /** The code `csm_code` takes over from, which is then let go. Sent alone, it removes it. */
    replace_csm_code?: string | null;
    /** Company employee code; null clears it, left out keeps it. */
    emp_code?: string | null;
  },
) {
  const res = await apiFetch<AuthUser>(`/users/${id}`, {
    method: "PUT",
    data,
  });
  return { user: res };
}
