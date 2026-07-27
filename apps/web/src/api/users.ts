import { apiFetch } from "./client";
import type { AppUser, AuthUser } from "@sb-oms/shared-types";
import type { UserRole } from "@sb-oms/shared-types";

export async function fetchUsers() {
  return apiFetch<{ users: AppUser[] }>("/users");
}

export async function checkUsername(username: string) {
  return apiFetch<{ available: boolean }>(`/users/check?username=${encodeURIComponent(username)}`);
}

export async function createUser(data: {
  name: string;
  username: string;
  password: string;
  role: Exclude<UserRole, "admin">;
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
  current_password?: string;
  new_password?: string;
}) {
  const res = await apiFetch<AuthUser>("/users/me", {
    method: "PUT",
    data,
  });
  return { user: res };
}

export async function toggleUserStatus(id: number, is_active: boolean) {
  const res = await apiFetch<AuthUser>(`/users/${id}/status`, {
    method: "PUT",
    data: { is_active },
  });
  return { user: res };
}

export async function updateUser(id: number, data: { name: string; username: string; role: string }) {
  const res = await apiFetch<AuthUser>(`/users/${id}`, {
    method: "PUT",
    data,
  });
  return { user: res };
}
