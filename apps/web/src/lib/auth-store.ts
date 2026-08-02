import { create } from "zustand";
import { authApi } from "../api/auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export type UserRole = "EMPLOYEE" | "PRODUCTION" | "ACCOUNTS" | "ADMIN" | "OPERATOR";

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  email?: string | null;
  phone?: string | null;
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
  EMPLOYEE: "/employee/dashboard",
  PRODUCTION: "/production/dashboard",
  ACCOUNTS: "/accountant/dashboard",
  ADMIN: "/admin/dashboard",
  OPERATOR: "/operator/assign",
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
