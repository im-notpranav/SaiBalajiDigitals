import { apiFetch } from "./client";
import type { AppUser, AuthUser } from "@/types";
import type { UserRole } from "@/types";

export async function fetchUsers() {
  return apiFetch<{ users: AppUser[] }>("/api/users");
}

export async function checkUsername(username: string) {
  return apiFetch<{ available: boolean }>(`/api/users/check?username=${encodeURIComponent(username)}`);
}

export async function createUser(data: {
  name: string;
  username: string;
  password: string;
  role: Exclude<UserRole, "admin">;
}) {
  return apiFetch<{ user: AuthUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: number) {
  return apiFetch<{ ok: boolean }>(`/api/users/${id}`, { method: "DELETE" });
}

export async function updateMe(data: {
  name?: string;
  current_password?: string;
  new_password?: string;
}) {
  return apiFetch<{ user: AuthUser }>("/api/users/me", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
