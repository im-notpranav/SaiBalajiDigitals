import { apiClient } from "./client";

export const authApi = {
  login: async (username: string, password: string) => {
    const { data } = await apiClient.post("/auth/login", { username, password });
    return data.user;
  },
  logout: async () => {
    await apiClient.post("/auth/logout");
  },
  getMe: async () => {
    const { data } = await apiClient.get("/auth/me");
    return data.user;
  },
};
