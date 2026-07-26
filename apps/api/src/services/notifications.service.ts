import { prisma } from "../utils/prisma";

export const notifyUser = async (userId: number, title: string, body: string, kind: string = "info") => {
  return prisma.notification.create({
    data: {
      user_id: userId,
      title,
      body,
      kind,
    },
  });
};

export const notifyRole = async (role: "ADMIN" | "EMPLOYEE" | "ACCOUNTS" | "PRODUCTION", title: string, body: string, kind: string = "info") => {
  const users = await prisma.user.findMany({ where: { role, is_active: true } });
  
  if (users.length === 0) return;

  return prisma.notification.createMany({
    data: users.map(u => ({
      user_id: u.id,
      title,
      body,
      kind,
    })),
  });
};
