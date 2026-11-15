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

export const notifyRole = async (role: "ADMIN" | "CSM" | "ACCOUNTS" | "PRODUCTION" | "PRODUCTION_MANAGER" | "OPERATION_MANAGER", title: string, body: string, kind: string = "info", orderId?: number | null) => {
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

/** Master Library: someone asked for a name missing from a pick-list. Every active admin is told. */
export const notifyNameRequested = (kindLabel: string, name: string, requesterName: string) =>
  notifyRole(
    "ADMIN",
    "New name request",
    `${requesterName} asked to add the ${kindLabel} "${name}". Add or reject it in the Master Library.`,
    "info",
  );

/** Master Library: tells the person who asked what the admin decided. */
export const notifyNameRequestDecided = (
  userId: number,
  decision: { approved: true; kindLabel: string; asked: string; added: string } | { approved: false; kindLabel: string; asked: string; reason: string },
) =>
  decision.approved
    ? notifyUser(
        userId,
        "Name added",
        decision.added === decision.asked
          ? `The ${decision.kindLabel} "${decision.added}" is now in the list.`
          : `The ${decision.kindLabel} you asked for is in the list as "${decision.added}".`,
        "success",
      )
    : notifyUser(
        userId,
        "Name not added",
        `The ${decision.kindLabel} "${decision.asked}" was not added: ${decision.reason}`,
        "warning",
      );
