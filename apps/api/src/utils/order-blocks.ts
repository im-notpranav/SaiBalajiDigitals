import { prisma } from "./prisma";

/**
 * Order-number blocks, per client (Masters → client): an order still open N days after its
 * order date (default 90), or an invoice still unpaid N days after its invoice date (default
 * 120), stops a CSM from opening a new order for that client. Days of 0 switch that block off.
 * Admins are never blocked. An admin may allow one order through an approved exception, used
 * within EXCEPTION_DAYS of approval.
 */

const DAY_MS = 24 * 3600_000;
export const EXCEPTION_DAYS = 7;
/** Orders that count as done for the pending block: closed, or fully paid. */
const DONE_STATUSES = ["Completed", "PaymentReceived"] as const;

export interface BlockReason {
  kind: "PENDING_ORDER" | "UNPAID_INVOICE";
  order_id: number;
  order_no: string;
  invoice_no?: string;
  since: string;
  days: number;
  limit: number;
}

export interface BlockState {
  client_name: string;
  blocked: boolean;
  reasons: BlockReason[];
  settings: { block_orders: boolean; pending_block_days: number; payment_block_days: number } | null;
  /** An approved, unused exception the user may spend on one order. */
  exception: { id: number; decided_at: string | null; expires_at: string | null } | null;
  /** The user's request waiting for the admin, if any. */
  pending_request: { id: number; created_at: string } | null;
}

const ageDays = (from: Date, now: number) => Math.floor((now - from.getTime()) / DAY_MS);

/** What blocks this client now, at most 20 reasons of each kind. */
export async function blockReasons(clientName: string): Promise<{ reasons: BlockReason[]; settings: BlockState["settings"] }> {
  const client = await prisma.client.findFirst({
    where: { name: { equals: clientName, mode: "insensitive" } },
    select: { block_orders: true, pending_block_days: true, payment_block_days: true },
  });
  if (!client || !client.block_orders) return { reasons: [], settings: client ?? null };
  const now = Date.now();
  const reasons: BlockReason[] = [];
  if (client.pending_block_days > 0) {
    const cutoff = new Date(now - client.pending_block_days * DAY_MS);
    const open = await prisma.order.findMany({
      where: {
        client_name: { equals: clientName, mode: "insensitive" },
        status: { notIn: [...DONE_STATUSES] },
        merged_into_id: null,
        date: { lt: cutoff },
      },
      select: { id: true, order_no: true, date: true },
      orderBy: { date: "asc" },
      take: 20,
    });
    for (const o of open)
      reasons.push({ kind: "PENDING_ORDER", order_id: o.id, order_no: o.order_no, since: o.date.toISOString(), days: ageDays(o.date, now), limit: client.pending_block_days });
  }
  if (client.payment_block_days > 0) {
    const cutoff = new Date(now - client.payment_block_days * DAY_MS);
    const unpaid = await prisma.invoice.findMany({
      where: {
        billing_date: { lt: cutoff },
        payment_received_at: null,
        order: { client_name: { equals: clientName, mode: "insensitive" }, status: { not: "Completed" } },
      },
      select: { invoice_no: true, billing_date: true, order: { select: { id: true, order_no: true } } },
      orderBy: { billing_date: "asc" },
      take: 20,
    });
    for (const i of unpaid)
      reasons.push({
        kind: "UNPAID_INVOICE",
        order_id: i.order.id,
        order_no: i.order.order_no,
        invoice_no: i.invoice_no,
        since: i.billing_date!.toISOString(),
        days: ageDays(i.billing_date!, now),
        limit: client.payment_block_days,
      });
  }
  return { reasons, settings: client };
}

/** An approved exception of this user for this client, not used and not expired. */
export async function usableException(userId: number, clientName: string) {
  return prisma.orderBlockException.findFirst({
    where: {
      requested_by: userId,
      client_name: { equals: clientName, mode: "insensitive" },
      status: "APPROVED",
      used_at: null,
      decided_at: { gte: new Date(Date.now() - EXCEPTION_DAYS * DAY_MS) },
    },
    orderBy: { decided_at: "asc" },
  });
}

export async function blockStateFor(user: { id: number; role: string }, clientName: string): Promise<BlockState> {
  const [{ reasons, settings }, exception, pending] = await Promise.all([
    blockReasons(clientName),
    usableException(user.id, clientName),
    prisma.orderBlockException.findFirst({
      where: { requested_by: user.id, client_name: { equals: clientName, mode: "insensitive" }, status: "PENDING" },
      select: { id: true, created_at: true },
    }),
  ]);
  return {
    client_name: clientName,
    blocked: user.role !== "ADMIN" && reasons.length > 0,
    reasons,
    settings,
    exception: exception
      ? {
          id: exception.id,
          decided_at: exception.decided_at?.toISOString() ?? null,
          expires_at: exception.decided_at ? new Date(exception.decided_at.getTime() + EXCEPTION_DAYS * DAY_MS).toISOString() : null,
        }
      : null,
    pending_request: pending ? { id: pending.id, created_at: pending.created_at.toISOString() } : null,
  };
}

export interface BlockedBody {
  message: string;
  blocked: true;
  client_name: string;
  reasons: BlockReason[];
}

export class OrderBlockedError extends Error {
  constructor(public readonly body: BlockedBody) {
    super(body.message);
  }
}

const describeReason = (r: BlockReason) =>
  r.kind === "PENDING_ORDER"
    ? `${r.order_no} is still open after ${r.days} days`
    : `invoice ${r.invoice_no} on ${r.order_no} is unpaid after ${r.days} days`;

/**
 * Before a non-admin opens an order: throws OrderBlockedError when the client is blocked and
 * the user holds no usable exception. Returns the exception to spend, if one is needed.
 */
export async function assertNotBlocked(user: { id: number; role: string }, clientName: string) {
  if (user.role === "ADMIN") return null;
  const { reasons } = await blockReasons(clientName);
  if (reasons.length === 0) return null;
  const exception = await usableException(user.id, clientName);
  if (exception) return exception;
  throw new OrderBlockedError({
    message: `New orders for ${clientName} are on hold: ${describeReason(reasons[0]!)}${reasons.length > 1 ? ` (and ${reasons.length - 1} more)` : ""}. Ask the admin for an exception.`,
    blocked: true,
    client_name: clientName,
    reasons,
  });
}

/** Marks an exception as spent on an order. False when it was already used. */
export async function spendException(id: number, orderId: number) {
  const r = await prisma.orderBlockException.updateMany({ where: { id, used_at: null }, data: { used_at: new Date(), used_order_id: orderId } });
  return r.count === 1;
}
