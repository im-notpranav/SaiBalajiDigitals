import { useQuery } from "@tanstack/react-query";
import { authApi } from "../api/auth";
import { queryClient } from "./query-client";

export type UserRole = "CSM" | "PRODUCTION" | "ACCOUNTS" | "ADMIN" | "OPERATION_MANAGER" | "PRODUCTION_MANAGER" | "COST_CONTROL_MANAGER" | "PASTER" | "HELPER" | "DRIVER";

/** Pasters, Helpers and Drivers share one mobile-first portal. */
export const FIELD_ROLES: UserRole[] = ["PASTER", "HELPER", "DRIVER"];

/** Operation Manager sees everything an admin sees but may not change orders or billing.
 *  The work-allocation pages (field staff, masters) are the exception: they write there. */
export const isReadOnlyRole = (role?: UserRole | string) => role === "OPERATION_MANAGER";

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  email?: string | null;
  phone?: string | null;
  /** Turned off WhatsApp messages (in-app notifications still arrive). */
  whatsapp_opt_out?: boolean;
  photo_url?: string | null;
  is_super_admin?: boolean;
}

const AUTH_KEY = ["auth", "me"];

/**
 * Who is signed in lives in one place, the /auth/me query. On a change of account everything cached
 * goes too, so nobody sees the last person's orders. A check still on its way is cancelled first,
 * or its out-of-date answer would land on top of the new one.
 */
async function setSignedInUser(user: AuthUser | null) {
  await queryClient.cancelQueries({ queryKey: AUTH_KEY });
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== AUTH_KEY[0] });
  queryClient.setQueryData(AUTH_KEY, user);
}

const login = async (username: string, password: string): Promise<AuthUser> => {
  const user: AuthUser = await authApi.login(username, password);
  await setSignedInUser(user);
  return user;
};

const logout = async () => {
  await authApi.logout();
  await setSignedInUser(null);
};

export const roleHome: Record<UserRole, string> = {
  CSM: "/employee/dashboard",
  PRODUCTION: "/production/dashboard",
  ACCOUNTS: "/accountant/dashboard",
  ADMIN: "/admin/dashboard",
  // Operation Manager shares the admin portal, read-only.
  OPERATION_MANAGER: "/admin/dashboard",
  PRODUCTION_MANAGER: "/prod-manager/dashboard",
  COST_CONTROL_MANAGER: "/cost-control/dashboard",
  PASTER: "/field/dashboard",
  HELPER: "/field/dashboard",
  DRIVER: "/field/dashboard",
};

export const useAuth = () => {
  const { data, isLoading } = useQuery<AuthUser | null>({
    queryKey: AUTH_KEY,
    queryFn: authApi.getMe,
    retry: false,
    // Used by nearly every component, so it must not ask the API each time one appears.
    staleTime: 5 * 60_000,
  });

  return { user: data ?? null, login, logout, isLoading };
};

/** Where to send a user after sign-in: the page they were sent away from, if it is a
 *  same-site path, otherwise their role's home. The portal guard still bounces a path
 *  that belongs to another role. */
export const postLoginPath = (user: AuthUser, redirect?: string) =>
  redirect && redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.startsWith("/login")
    ? redirect
    : roleHome[user.role];
