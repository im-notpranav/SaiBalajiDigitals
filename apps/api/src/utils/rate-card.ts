import { prisma } from "./prisma";
import { notifyRole } from "../services/notifications.service";
import { recomputeOrderStatus } from "./order-derive";

/**
 * Rate cards: the agreed rate for one client and one line item, from a date. An order line
 * takes the rate valid on the order's date. A CSM who types another rate gets the card rate
 * billed until an admin approves theirs, through a RATE_CHANGE request on the order.
 */

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const sNo = (n: number) => `S${String(n).padStart(2, "0")}`;

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The day (in India) of a moment, or a YYYY-MM-DD as is, as the DATE column stores it. */
export const dayOf = (d: Date | string) =>
  new Date(`${(typeof d === "string" ? d : new Date(d.getTime() + IST_OFFSET_MS).toISOString()).slice(0, 10)}T00:00:00.000Z`);

/**
 * The active rate per line item for one client on one day, keyed by the line item's name in
 * lower case. The newest entry that has started by that day wins.
 */
export async function cardRatesFor(clientName: string, on: Date | string = new Date()) {
  const rows = await prisma.rateCard.findMany({
    where: {
      status: "ACTIVE",
      effective_from: { lte: dayOf(on) },
      client: { name: { equals: clientName, mode: "insensitive" } },
    },
    include: { media: { select: { name: true } } },
    orderBy: [{ effective_from: "desc" }, { id: "desc" }],
  });
  const rates = new Map<string, { media: string; rate: number; effective_from: Date; id: number }>();
  for (const r of rows) {
    const key = r.media.name.toLowerCase();
    if (!rates.has(key)) rates.set(key, { media: r.media.name, rate: Number(r.rate), effective_from: r.effective_from, id: r.id });
  }
  return rates;
}

interface Actor {
  id: number;
  name: string;
  role: string;
}

export interface RateChangePayload {
  items: { id: number; asked: number; card: number }[];
}

/**
 * After a CSM saves new lines: any line whose rate is not the card's goes back to the card
 * rate, keeps the CSM's rate as asked, and one RATE_CHANGE request on the order lists them
 * for the admin. Admins' rates stand. Lines with no card entry keep the typed rate.
 */
export async function holdRateDeviations(orderId: number, user: Actor, itemIds?: number[]) {
  if (user.role === "ADMIN") return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      order_no: true,
      client_name: true,
      date: true,
      items: {
        where: { rate_requested: null, ...(itemIds ? { id: { in: itemIds } } : {}) },
        select: { id: true, s_no: true, media: true, rate: true, total_sft: true, orderStore: { select: { s_no: true } } },
      },
    },
  });
  if (!order || order.items.length === 0) return null;
  const card = await cardRatesFor(order.client_name, order.date);
  if (card.size === 0) return null;
  const off = order.items
    .map((i) => ({ i, c: card.get(i.media.toLowerCase()) }))
    .filter((x): x is { i: (typeof order.items)[number]; c: NonNullable<typeof x.c> } => !!x.c && Number(x.i.rate) !== x.c.rate);
  if (off.length === 0) return null;

  const payload: RateChangePayload = { items: off.map(({ i, c }) => ({ id: i.id, asked: Number(i.rate), card: c.rate })) };
  const summary = off
    .map(({ i, c }) => `${i.orderStore ? `${sNo(i.orderStore.s_no)} ` : ""}line ${i.s_no} (${i.media}): ${money(Number(i.rate))} asked, card ${money(c.rate)}`)
    .join("\n");

  const request = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
    for (const { i, c } of off) {
      await tx.orderItem.update({
        where: { id: i.id },
        data: { rate_requested: i.rate, rate: c.rate, amount: Number((Number(i.total_sft) * c.rate).toFixed(2)) },
      });
    }
    await recomputeOrderStatus(tx, order.id);
    return tx.changeRequest.create({
      data: {
        order_id: order.id,
        kind: "RATE_CHANGE",
        reason: "The rate typed is not the client's rate card rate.",
        summary,
        payload: payload as any,
        requested_by: user.id,
      },
    });
  });
  await notifyRole(
    "ADMIN",
    `Rate change asked on ${order.order_no}`,
    `${user.name} typed ${off.length === 1 ? "a rate" : `${off.length} rates`} other than the rate card. The card rate is billed until you approve.`,
    "warning",
    order.id,
  ).catch(() => {});
  return request;
}

/** Approving a RATE_CHANGE: each line still waiting takes the CSM's rate. */
export async function approveRateChange(payload: RateChangePayload, admin: Actor) {
  const ids = (payload?.items ?? []).map((i) => i.id);
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${admin.id.toString()}, true)`;
    const lines = await tx.orderItem.findMany({ where: { id: { in: ids }, rate_requested: { not: null } } });
    const orders = new Set<number>();
    for (const l of lines) {
      const rate = Number(l.rate_requested);
      await tx.orderItem.update({
        where: { id: l.id },
        data: { rate, rate_requested: null, amount: Number((Number(l.total_sft) * rate).toFixed(2)) },
      });
      orders.add(l.order_id);
    }
    for (const o of orders) await recomputeOrderStatus(tx, o);
  });
}

/** Rejecting or withdrawing a RATE_CHANGE: the lines stay at the card rate. */
export async function rejectRateChange(payload: RateChangePayload) {
  const ids = (payload?.items ?? []).map((i) => i.id);
  if (ids.length === 0) return;
  await prisma.orderItem.updateMany({ where: { id: { in: ids } }, data: { rate_requested: null } });
}
