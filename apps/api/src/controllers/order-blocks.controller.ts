import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { notifyRole, notifyUser } from "../services/notifications.service";
import { blockStateFor, EXCEPTION_DAYS } from "../utils/order-blocks";

/**
 * Order-number blocks: what blocks a client for the signed-in user, the CSM's request for an
 * exception, the admin's decision, and the per-client settings.
 */

const DAY_MS = 24 * 3600_000;

/** GET /api/order-blocks/check?client=… */
export const checkBlock = async (req: Request, res: Response) => {
  const client = String(req.query.client ?? "").trim();
  if (!client) return res.status(400).json({ message: "Pick a client." });
  try {
    return res.json(await blockStateFor(req.user!, client));
  } catch (err) {
    console.error("checkBlock", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const requestSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(5, "Say why this order cannot wait.").max(1000),
});

/** POST /api/order-blocks/exceptions — a CSM asks the admin to allow one order. */
export const requestException = async (req: Request, res: Response) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
  const user = req.user!;
  try {
    const client = await prisma.client.findFirst({ where: { name: { equals: parsed.data.client_name, mode: "insensitive" } }, select: { name: true } });
    if (!client) return res.status(400).json({ message: "That client is not in the Master Library." });
    const state = await blockStateFor(user, client.name);
    if (!state.blocked) return res.status(400).json({ message: `${client.name} is not on hold. You can open the order.` });
    if (state.exception) return res.status(409).json({ message: "You already have an approved exception for this client. Open the order." });
    if (state.pending_request) return res.status(409).json({ message: "Your request for this client is already with the admin." });
    const created = await prisma.orderBlockException.create({
      data: { client_name: client.name, reason: parsed.data.reason, requested_by: user.id },
    });
    await notifyRole(
      "ADMIN",
      `Order exception asked for ${client.name}`,
      `${user.name} needs a new order for ${client.name}, which is on hold. Reason: ${parsed.data.reason}`,
      "warning",
      null,
      "/admin/order-blocks",
    ).catch(() => {});
    return res.status(201).json({ exception: created });
  } catch (err) {
    console.error("requestException", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/order-blocks/exceptions?status=… — the admin sees all; others their own. */
export const listExceptions = async (req: Request, res: Response) => {
  const user = req.user!;
  const status = String(req.query.status ?? "");
  try {
    const rows = await prisma.orderBlockException.findMany({
      where: {
        ...(user.role === "ADMIN" ? {} : { requested_by: user.id }),
        ...(status === "PENDING" || status === "APPROVED" || status === "REJECTED" ? { status } : {}),
      },
      orderBy: [{ created_at: "desc" }],
      take: 300,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter((x): x is number => !!x))];
    const orderIds = rows.map((r) => r.used_order_id).filter((x): x is number => !!x);
    const [people, orders] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, username: true } }),
      prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, order_no: true } }),
    ]);
    const who = new Map(people.map((p) => [p.id, p]));
    const orderNo = new Map(orders.map((o) => [o.id, o.order_no]));
    const now = Date.now();
    const exceptions = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        requester: r.requested_by ? who.get(r.requested_by) ?? null : null,
        decider: r.decided_by ? who.get(r.decided_by) ?? null : null,
        used_order_no: r.used_order_id ? orderNo.get(r.used_order_id) ?? null : null,
        expired: r.status === "APPROVED" && !r.used_at && !!r.decided_at && now - r.decided_at.getTime() > EXCEPTION_DAYS * DAY_MS,
        // The admin sees why the client is on hold while deciding.
        reasons:
          r.status === "PENDING" && user.role === "ADMIN"
            ? (await blockStateFor({ id: r.requested_by ?? 0, role: "CSM" }, r.client_name)).reasons
            : undefined,
      })),
    );
    return res.json({ exceptions });
  } catch (err) {
    console.error("listExceptions", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/order-blocks/exceptions/count — the sidebar badge. */
export const exceptionCount = async (_req: Request, res: Response) => {
  const pending = await prisma.orderBlockException.count({ where: { status: "PENDING" } });
  return res.json({ pending });
};

const decideSchema = z.object({ note: z.string().trim().max(1000).optional().nullable() });

async function decide(req: Request, res: Response, approve: boolean) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
  const parsed = decideSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
  const note = parsed.data.note || null;
  if (!approve && !note) return res.status(400).json({ message: "Say why the exception is refused." });
  const admin = req.user!;
  try {
    const r = await prisma.orderBlockException.updateMany({
      where: { id, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "REJECTED", decided_by: admin.id, decided_at: new Date(), decision_note: note },
    });
    if (r.count === 0) return res.status(409).json({ message: "This request was already decided or withdrawn." });
    const row = await prisma.orderBlockException.findUniqueOrThrow({ where: { id } });
    if (row.requested_by)
      await notifyUser(
        row.requested_by,
        approve ? `Exception allowed for ${row.client_name}` : `Exception refused for ${row.client_name}`,
        approve
          ? `You may open one order for ${row.client_name} within ${EXCEPTION_DAYS} days.${note ? ` Note: ${note}` : ""}`
          : `Reason: ${note}`,
        approve ? "success" : "warning",
        null,
        approve ? "/employee/new-order" : null,
      ).catch(() => {});
    return res.json({ exception: row });
  } catch (err) {
    console.error("decideException", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export const approveException = (req: Request, res: Response) => decide(req, res, true);
export const rejectException = (req: Request, res: Response) => decide(req, res, false);

/** DELETE /api/order-blocks/exceptions/:id — the requester withdraws a request still waiting. */
export const withdrawException = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
  const r = await prisma.orderBlockException.deleteMany({ where: { id, status: "PENDING", requested_by: req.user!.id } });
  if (r.count === 0) return res.status(404).json({ message: "No waiting request of yours with that id." });
  return res.json({ ok: true });
};

const settingsSchema = z.object({
  block_orders: z.boolean().optional(),
  pending_block_days: z.number().int().min(0).max(3650).optional(),
  payment_block_days: z.number().int().min(0).max(3650).optional(),
});

/** GET /api/order-blocks/clients — every client's block settings (admin). */
export const listBlockSettings = async (_req: Request, res: Response) => {
  const clients = await prisma.client.findMany({
    where: { is_active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, block_orders: true, pending_block_days: true, payment_block_days: true },
  });
  return res.json({ clients });
};

/** PUT /api/order-blocks/clients/:id — switch the block on or off, or change its days (admin). */
export const updateBlockSettings = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Days must be whole numbers from 0 to 3650." });
  try {
    const client = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${req.user!.id.toString()}, true)`;
      return tx.client.update({
        where: { id },
        data: parsed.data,
        select: { id: true, name: true, code: true, block_orders: true, pending_block_days: true, payment_block_days: true },
      });
    });
    return res.json({ client });
  } catch (err: any) {
    if (err?.code === "P2025") return res.status(404).json({ message: "Client not found" });
    console.error("updateBlockSettings", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
