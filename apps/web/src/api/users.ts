import { apiClient, apiFetch } from "./client";
import type { AppUser, AuthUser } from "@sb-oms/shared-types";
import type { UserRole } from "@sb-oms/shared-types";

/** Where to load a user's picture from: stored paths are relative to the API. */
export const photoSrc = (url?: string | null) =>
  url ? (url.startsWith("/") ? `${apiClient.defaults.baseURL}${url}` : url) : undefined;

export async function fetchUsers() {
  return apiFetch<{ users: AppUser[] }>("/users");
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
}) {
  const res = await apiFetch<AuthUser>("/users", {
    method: "POST",
    data,
  });
  return { user: res };
}

export async function deleteUser(id: number) {
  return apiFetch<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" });
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

export const uploadMyPhoto = (picture: Blob) =>
  apiFetch<AuthUser>("/users/me/photo", {
    method: "POST",
    data: picture,
    headers: { "Content-Type": "application/octet-stream" },
  });

export const removeMyPhoto = () => apiFetch<AuthUser>("/users/me/photo", { method: "DELETE" });

export async function toggleUserStatus(id: number, is_active: boolean) {
  const res = await apiFetch<AuthUser>(`/users/${id}/status`, {
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
  data: { name: string; username: string; role: string; phone: string; email: string; whatsapp_opt_out?: boolean },
) {
  const res = await apiFetch<AuthUser>(`/users/${id}`, {
    method: "PUT",
    data,
  });
  return { user: res };
}
