import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { notifyRole } from "../services/notifications.service";
import { serializeDecimals } from "../utils/serialize";

/**
 * Machines and the machine queue. Each line item has a default machine; a new line takes it
 * (a database trigger fills it) and waits in that machine's queue for every operator on the
 * machine. The first operator to start it takes it. An operator who can't do a line rejects
 * it with a reason and it goes to the Production Manager, who may change a line's machine or
 * team at any time.
 */

const OPEN_ORDER = { status: { notIn: ["Completed", "PaymentReceived"] as any } };
const sNo = (n: number) => `S${String(n).padStart(2, "0")}`;

const machineSchema = z.object({
  name: z.string().trim().min(1, "Give the machine a name.").max(60),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});
const machineIdSchema = z.object({ machine_id: z.number().int().positive().nullable() });
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Give a reason.").max(500) });

const fail = (res: Response, err: unknown, where: string) => {
  console.error(where, err);
  return res.status(500).json({ message: "Internal server error" });
};

// --- Machines ---------------------------------------------------------------

/** GET /api/machines — every machine with how many operators and line items use it. */
export const listMachines = async (_req: Request, res: Response) => {
  try {
    const machines = await prisma.machine.findMany({
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
      include: { _count: { select: { operators: { where: { is_active: true, role: "PRODUCTION" } }, media: true } } },
    });
    return res.json({
      machines: machines.map((m) => ({
        id: m.id,
        name: m.name,
        is_active: m.is_active,
        sort_order: m.sort_order,
        operator_count: m._count.operators,
        media_count: m._count.media,
      })),
    });
  } catch (err) {
    return fail(res, err, "listMachines");
  }
};

/** POST /api/machines — super admin. */
export const createMachine = async (req: Request, res: Response) => {
  try {
    const parsed = machineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
    const clash = await prisma.machine.findFirst({ where: { name: { equals: parsed.data.name, mode: "insensitive" } } });
    if (clash) return res.status(409).json({ message: `${clash.name} is already a machine.` });
    const max = await prisma.machine.aggregate({ _max: { sort_order: true } });
    const machine = await prisma.machine.create({
      data: { name: parsed.data.name, sort_order: parsed.data.sort_order ?? (max._max.sort_order ?? 0) + 1 },
    });
    return res.status(201).json({ machine });
  } catch (err) {
    return fail(res, err, "createMachine");
  }
};

/** PATCH /api/machines/:id — super admin: rename, reorder, or switch off. */
export const updateMachine = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = machineSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
    if (!(await prisma.machine.findUnique({ where: { id } }))) return res.status(404).json({ message: "Machine not found." });
    if (parsed.data.name) {
      const clash = await prisma.machine.findFirst({ where: { id: { not: id }, name: { equals: parsed.data.name, mode: "insensitive" } } });
      if (clash) return res.status(409).json({ message: `${clash.name} is already a machine.` });
    }
    const machine = await prisma.machine.update({ where: { id }, data: parsed.data });
    return res.json({ machine });
  } catch (err) {
    return fail(res, err, "updateMachine");
  }
};

/** GET /api/machines/setup — line items with their default machine, and operators with theirs. */
export const machineSetup = async (_req: Request, res: Response) => {
  try {
    const [machines, media, operators] = await Promise.all([
      prisma.machine.findMany({ orderBy: [{ sort_order: "asc" }, { name: "asc" }] }),
      prisma.media.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, is_active: true, default_machine_id: true } }),
      prisma.user.findMany({
        where: { role: "PRODUCTION", deleted_at: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, username: true, is_active: true, machine_id: true },
      }),
    ]);
    return res.json({ machines, media, operators });
  } catch (err) {
    return fail(res, err, "machineSetup");
  }
};

/** PUT /api/machines/media/:id — super admin: a line item's default machine. */
export const setMediaMachine = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = machineIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Pick a machine." });
    if (parsed.data.machine_id && !(await prisma.machine.findUnique({ where: { id: parsed.data.machine_id } }))) {
      return res.status(400).json({ message: "Machine not found." });
    }
    const media = await prisma.media.update({ where: { id }, data: { default_machine_id: parsed.data.machine_id } });
    return res.json({ media });
  } catch (err) {
    return fail(res, err, "setMediaMachine");
  }
};

/** PUT /api/machines/operators/:id — the PM or super admin: the machine an operator works. */
export const setOperatorMachine = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = machineIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Pick a machine." });
    const op = await prisma.user.findUnique({ where: { id } });
    if (!op || op.role !== "PRODUCTION") return res.status(404).json({ message: "Operator not found." });
    if (parsed.data.machine_id && !(await prisma.machine.findUnique({ where: { id: parsed.data.machine_id } }))) {
      return res.status(400).json({ message: "Machine not found." });
    }
    await prisma.user.update({ where: { id }, data: { machine_id: parsed.data.machine_id } });
    return res.json({ ok: true });
  } catch (err) {
    return fail(res, err, "setOperatorMachine");
  }
};

// --- The machine queue ------------------------------------------------------

const lineSelect = {
  id: true,
  s_no: true,
  media: true,
  width_inches: true,
  height_inches: true,
  qty: true,
  total_sft: true,
  machine_id: true,
  started_at: true,
  started_by: true,
  returned_reason: true,
  returned_at: true,
  is_flagged: true,
  production_completed: true,
  orderStore: { select: { s_no: true, store_name: true, location: true } },
  order: { select: { id: true, order_no: true, client_name: true, date: true, created_by: true, creator_name: true } },
  assignments: { select: { user_id: true, completed: true, assigned_at: true, user: { select: { id: true, name: true } } } },
} as const;

/** GET /api/production/machine-queue — the operator's machine and the lines waiting on it. */
export const myMachineQueue = async (req: Request, res: Response) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { machine: true } });
    if (!me?.machine) return res.json({ machine: null, lines: [] });
    const lines = await prisma.orderItem.findMany({
      where: {
        machine_id: me.machine.id,
        production_completed: false,
        returned_at: null,
        assignments: { none: {} },
        order: OPEN_ORDER,
      },
      select: lineSelect,
      orderBy: [{ order: { date: "asc" } }, { id: "asc" }],
      take: 500,
    });
    return res.json({ machine: me.machine, lines: serializeDecimals(lines) });
  } catch (err) {
    return fail(res, err, "myMachineQueue");
  }
};

/**
 * POST /api/production/lines/:id/start — the operator starts a line. From the machine queue the
 * first to start takes it; on a line already given to them it records the start.
 */
export const startLine = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const user = req.user!;
    const me = await prisma.user.findUnique({ where: { id: user.id }, select: { machine_id: true } });
    const line = await prisma.orderItem.findUnique({ where: { id }, select: { ...lineSelect, order: { select: { id: true, order_no: true, status: true } } } });
    if (!line) return res.status(404).json({ message: "Line not found." });
    if (line.production_completed) return res.status(400).json({ message: "This line is already made." });
    if (["Completed", "PaymentReceived"].includes(line.order.status)) return res.status(400).json({ message: "This order is closed." });

    const mine = line.assignments.find((a) => a.user_id === user.id);
    if (mine) {
      if (!line.started_at) await prisma.orderItem.update({ where: { id }, data: { started_at: new Date(), started_by: user.id } });
      return res.json({ ok: true, taken: false });
    }
    if (line.assignments.length > 0) {
      return res.status(409).json({ message: `${line.assignments.map((a) => a.user.name).join(", ")} already took this line.` });
    }
    if (!me?.machine_id || line.machine_id !== me.machine_id) return res.status(403).json({ message: "This line is not on your machine." });
    if (line.returned_at) return res.status(409).json({ message: "This line was sent to the Production Manager." });

    const taken = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      // Only one operator can move started_at off null: that one takes the line.
      const claim = await tx.orderItem.updateMany({ where: { id, started_at: null }, data: { started_at: new Date(), started_by: user.id } });
      if (claim.count === 0) return false;
      const already = await tx.orderItemAssignment.count({ where: { order_item_id: id } });
      if (already > 0) return false;
      await tx.orderItemAssignment.create({ data: { order_item_id: id, user_id: user.id, assigned_by: user.id } });
      return true;
    });
    if (!taken) return res.status(409).json({ message: "Another operator started this line first." });
    return res.json({ ok: true, taken: true });
  } catch (err) {
    return fail(res, err, "startLine");
  }
};

/**
 * POST /api/production/lines/:id/reject — the operator can't do a line, from the queue or
 * their own: it leaves the queue and goes to the Production Manager with the reason.
 */
export const rejectLine = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Give a reason." });
    const user = req.user!;
    const me = await prisma.user.findUnique({ where: { id: user.id }, select: { machine_id: true } });
    const line = await prisma.orderItem.findUnique({ where: { id }, select: lineSelect });
    if (!line) return res.status(404).json({ message: "Line not found." });
    const mine = line.assignments.find((a) => a.user_id === user.id);
    const inMyQueue = line.assignments.length === 0 && !!me?.machine_id && line.machine_id === me.machine_id && !line.returned_at;
    if (!mine && !inMyQueue) return res.status(403).json({ message: "This line is not yours or on your machine." });
    if (mine?.completed || line.production_completed) return res.status(400).json({ message: "This line is already made." });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      if (mine) await tx.orderItemAssignment.delete({ where: { order_item_id_user_id: { order_item_id: id, user_id: user.id } } });
      const left = await tx.orderItemAssignment.count({ where: { order_item_id: id } });
      await tx.orderItem.update({
        where: { id },
        data: {
          returned_reason: parsed.data.reason,
          returned_at: new Date(),
          returned_by: user.id,
          ...(left === 0 ? { started_at: null, started_by: null } : {}),
        },
      });
    });
    const where = line.orderStore ? `${sNo(line.orderStore.s_no)} ` : "";
    await notifyRole(
      "PRODUCTION_MANAGER",
      `Line rejected on ${line.order.order_no}`,
      `${user.name} can't do ${where}line ${line.s_no} (${line.media}): ${parsed.data.reason}. Change its machine or team.`,
      "warning",
      line.order.id,
    ).catch(() => {});
    return res.json({ ok: true });
  } catch (err) {
    return fail(res, err, "rejectLine");
  }
};

/**
 * PATCH /api/production/lines/:id/machine — the PM moves a line to another machine, at any
 * time. Work not yet finished leaves its operator and queues on the new machine.
 */
export const changeLineMachine = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = machineIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Pick a machine." });
    const line = await prisma.orderItem.findUnique({ where: { id }, select: lineSelect });
    if (!line) return res.status(404).json({ message: "Line not found." });
    if (line.production_completed) return res.status(400).json({ message: "This line is already made." });
    if (parsed.data.machine_id && !(await prisma.machine.findFirst({ where: { id: parsed.data.machine_id, is_active: true } }))) {
      return res.status(400).json({ message: "Pick an active machine." });
    }
    const user = req.user!;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      await tx.orderItemAssignment.deleteMany({ where: { order_item_id: id, completed: false } });
      await tx.orderItem.update({
        where: { id },
        data: { machine_id: parsed.data.machine_id, started_at: null, started_by: null, returned_reason: null, returned_at: null, returned_by: null },
      });
    });
    const fresh = await prisma.orderItem.findUnique({ where: { id }, select: lineSelect });
    return res.json({ line: serializeDecimals(fresh) });
  } catch (err) {
    return fail(res, err, "changeLineMachine");
  }
};

/**
 * GET /api/production/board — the Production Manager's machine board: every open line with its
 * machine, who has it, whether it was rejected, plus the machines and their operators.
 */
export const machineBoard = async (_req: Request, res: Response) => {
  try {
    const [machines, operators, lines] = await Promise.all([
      prisma.machine.findMany({ where: { is_active: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }] }),
      prisma.user.findMany({
        where: { role: "PRODUCTION", is_active: true, deleted_at: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, machine_id: true },
      }),
      prisma.orderItem.findMany({
        where: { production_completed: false, order: OPEN_ORDER },
        select: lineSelect,
        orderBy: [{ order: { date: "asc" } }, { id: "asc" }],
        take: 2000,
      }),
    ]);
    const completedToday = await prisma.orderItem.count({
      where: { production_completed: true, production_completed_at: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    });
    return res.json({ machines, operators, lines: serializeDecimals(lines), completed_today: completedToday });
  } catch (err) {
    return fail(res, err, "machineBoard");
  }
};
