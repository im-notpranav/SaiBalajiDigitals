import { create } from "zustand";
import { authApi } from "../api/auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

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

interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  login: async (username, password) => {
    const user = await authApi.login(username, password);
    set({ user });
    return user;
  },
  logout: async () => {
    await authApi.logout();
    set({ user: null });
  },
}));

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
  const store = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: authApi.getMe,
    retry: false,
  });

  useEffect(() => {
    if (data !== undefined && data !== store.user) {
      store.setUser(data || null);
    }
  }, [data, store]);

  return {
    user: store.user,
    login: store.login,
    logout: store.logout,
    isLoading,
  };
};
