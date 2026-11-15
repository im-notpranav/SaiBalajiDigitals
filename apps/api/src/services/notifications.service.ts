import { prisma } from "../utils/prisma";

/**
 * Where a notification leads, in the same form as the WhatsApp "Open in app" links (/go/...):
 * "order/30", "pr/28", "job/12/30", "leave", "overtime", "library/requests". The web app works
 * out the page from the reader's role. Left out, a notification about an order leads to it.
 */
const linkFor = (orderId?: number | null, link?: string | null) => link ?? (orderId ? `order/${orderId}` : null);

export const notifyUser = async (userId: number, title: string, body: string, kind: string = "info", orderId?: number | null, link?: string | null) => {
  return prisma.notification.create({
    data: {
      user_id: userId,
      title,
      body,
      kind,
      order_id: orderId ?? null,
      link: linkFor(orderId, link),
    },
  });
};

export const notifyRole = async (role: "ADMIN" | "CSM" | "ACCOUNTS" | "PRODUCTION" | "PRODUCTION_MANAGER" | "OPERATION_MANAGER", title: string, body: string, kind: string = "info", orderId?: number | null, link?: string | null) => {
  const users = await prisma.user.findMany({ where: { role, is_active: true } });

  if (users.length === 0) return;

  return prisma.notification.createMany({
    data: users.map(u => ({
      user_id: u.id,
      title,
      body,
      kind,
      order_id: orderId ?? null,
      link: linkFor(orderId, link),
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
    null,
    "library/requests",
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
