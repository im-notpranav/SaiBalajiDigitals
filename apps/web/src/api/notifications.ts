import { apiClient } from "./client";
import type { Notification } from "@sb-oms/shared-types";

export const fetchMyNotifications = async (): Promise<Notification[]> => {
  const { data } = await apiClient.get<{ notifications: Notification[] }>("/notifications");
  return data.notifications;
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await apiClient.put("/notifications/read-all");
};

export const markNotificationRead = async (id: number | string): Promise<void> => {
  await apiClient.put(`/notifications/${id}/read`);
};
