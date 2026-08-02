import { prisma } from "../utils/prisma";

export const notifyUser = async (userId: number, title: string, body: string, kind: string = "info", orderId?: number | null) => {
  return prisma.notification.create({
    data: {
      user_id: userId,
      title,
      body,
      kind,
      order_id: orderId ?? null,
    },
  });
};

export const notifyRole = async (role: "ADMIN" | "EMPLOYEE" | "ACCOUNTS" | "PRODUCTION" | "OPERATOR", title: string, body: string, kind: string = "info", orderId?: number | null) => {
  const users = await prisma.user.findMany({ where: { role, is_active: true } });

  if (users.length === 0) return;

  return prisma.notification.createMany({
    data: users.map(u => ({
      user_id: u.id,
      title,
      body,
      kind,
      order_id: orderId ?? null,
    })),
  });
};
