import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { notifyUser } from "../services/notifications.service";
import { sanitizeZodErrors } from "../utils/sanitize-errors";

const FIELD_ROLES = new Set(["PASTER", "HELPER", "DRIVER"]);

const noteSchema = z.object({
  body: z.string().trim().min(1, "Write the note first.").max(2000, "Keep a note under 2000 characters."),
});

/**
 * Who may read and add to an order's notes: anyone working on the order. Office roles see
 * every order; an operator only orders with a line given to them; field staff only orders
 * they have a job on.
 */
export async function canUseOrderNotes(user: { id: number; role: string }, orderId: number): Promise<boolean> {
  if (user.role === "PRODUCTION") {
    const mine = await prisma.orderItemAssignment.count({ where: { user_id: user.id, orderItem: { order_id: orderId } } });
    return mine > 0;
  }
  if (FIELD_ROLES.has(user.role)) {
    const mine = await prisma.workJobMember.count({ where: { user_id: user.id, job: { order_id: orderId } } });
    return mine > 0;
  }
  return true;
}

/** GET /api/orders/:id/notes — the whole thread, oldest first. */
export const getOrderNotes = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) return res.status(400).json({ message: "Invalid order." });
    if (!(await canUseOrderNotes(req.user!, orderId))) return res.status(403).json({ message: "You can't see this order's notes." });
    const notes = await prisma.orderNote.findMany({
      where: { order_id: orderId },
      orderBy: { created_at: "asc" },
      select: { id: true, body: true, author_id: true, author_name: true, author_role: true, created_at: true },
    });
    return res.json({ notes });
  } catch (error) {
    console.error("getOrderNotes error:", error);
    return res.status(500).json({ message: "Could not load the notes." });
  }
};

/** POST /api/orders/:id/notes — add one note. The order's CSM hears about notes others add. */
export const addOrderNote = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) return res.status(400).json({ message: "Invalid order." });
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid note.", errors: sanitizeZodErrors(parsed.error) });
    const user = req.user!;
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, order_no: true, created_by: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!(await canUseOrderNotes(user, orderId))) return res.status(403).json({ message: "You can't add notes to this order." });

    const author = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, role: true } });
    const note = await prisma.orderNote.create({
      data: {
        order_id: orderId,
        body: parsed.data.body,
        author_id: user.id,
        author_name: author?.name ?? "Unknown",
        author_role: (author?.role ?? user.role) as any,
      },
      select: { id: true, body: true, author_id: true, author_name: true, author_role: true, created_at: true },
    });

    if (order.created_by && order.created_by !== user.id) {
      const preview = note.body.length > 120 ? `${note.body.slice(0, 117)}…` : note.body;
      await notifyUser(order.created_by, `New note on ${order.order_no}`, `${note.author_name}: ${preview}`, "info", order.id, `order/${order.id}`).catch(() => {});
    }
    return res.status(201).json({ note });
  } catch (error) {
    console.error("addOrderNote error:", error);
    return res.status(500).json({ message: "Could not save the note." });
  }
};
