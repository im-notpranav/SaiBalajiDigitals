import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { ensureLookupValue } from "../utils/lookups";
import { notifyRole, notifyUser } from "../services/notifications.service";
import { generateOrderId, previewOrderNumbers } from "../utils/order-sequence";
import { amountOf, buildOrderTemplate, parseOrderTemplate, sftOf } from "../utils/order-template";
import { bulkOrdersSchema } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";

/** GET /api/orders/template — the company's order sheet, ready to fill in. */
export const orderTemplate = async (_req: Request, res: Response) => {
  try {
    res.setHeader("Content-Disposition", "attachment; filename=Bulk_Order_Request.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buildOrderTemplate());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/orders/bulk/preview — reads an uploaded sheet and saves nothing, so the person can
 * see each client's order first. The numbers shown are what the sequence would give right now.
 */
export const previewBulkOrders = async (req: Request, res: Response) => {
  try {
    const buf = req.body;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ message: "No file received. Upload the .xlsx file as the request body." });
    }
    const { orders, errors, fileError } = parseOrderTemplate(buf);
    if (fileError) return res.status(400).json({ message: fileError });
    const numbers = await previewOrderNumbers(orders.length);
    return res.status(200).json({
      orders: orders.map((o, i) => ({ ...o, expected_order_no: numbers[i] ?? null })),
      errors: errors.slice(0, 200),
      error_count: errors.length,
    });
  } catch (err) {
    console.error("Bulk preview error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/orders/bulk — saves the orders from the review screen, all or none. A CSM's orders
 * are their own; an admin picks a CSM for each. Figures are worked out again here rather than
 * trusted from the browser.
 */
export const createBulkOrders = async (req: Request, res: Response) => {
  try {
    const parsed = bulkOrdersSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";

    const owners = new Map<number, string>();
    if (isAdmin) {
      const missing = parsed.data.orders.find((o) => !o.csm_user_id);
      if (missing) return res.status(400).json({ message: `Pick a CSM for ${missing.client_name}.` });
      const ids = [...new Set(parsed.data.orders.map((o) => o.csm_user_id!))];
      const csms = await prisma.user.findMany({ where: { id: { in: ids }, role: "CSM", is_active: true }, select: { id: true, name: true } });
      csms.forEach((c) => owners.set(c.id, c.name));
      if (csms.length !== ids.length) return res.status(400).json({ message: "Pick an active CSM for every order." });
    } else {
      const me = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
      owners.set(user.id, me?.name ?? user.username);
    }

    // Numbers are taken first, as the sequence runs its own transaction. A failure below leaves a gap.
    const numbers: string[] = [];
    for (let i = 0; i < parsed.data.orders.length; i++) numbers.push(await generateOrderId());

    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const saved: { id: number; order_no: string; client_name: string; created_by: number }[] = [];
      for (const [i, o] of parsed.data.orders.entries()) {
        const ownerId = isAdmin ? o.csm_user_id! : user.id;
        const date = new Date(`${o.date}T00:00:00.000Z`);
        await ensureLookupValue(tx, "client", o.client_name);
        for (const s of o.stores) for (const it of s.items) await ensureLookupValue(tx, "media", it.media);

        const order = await tx.order.create({
          data: {
            order_no: numbers[i]!,
            client_name: o.client_name,
            date,
            created_at: date, // the sheet's date drives the turnaround clock
            created_by: ownerId,
            creator_name: owners.get(ownerId)!,
            status: "Active",
            stores: { create: o.stores.map((s, n) => ({ s_no: n + 1, store_name: s.store_name, location: s.location })) },
          },
          include: { stores: { orderBy: { s_no: "asc" } } },
        });
        await tx.orderItem.createMany({
          data: order.stores.flatMap((row, n) =>
            o.stores[n]!.items.map((it, k) => {
              const total_sft = sftOf(it.width_inches, it.height_inches, it.qty);
              return {
                order_id: order.id,
                order_store_id: row.id,
                s_no: k + 1,
                media: it.media,
                width_inches: it.width_inches,
                height_inches: it.height_inches,
                qty: it.qty,
                rate: it.rate,
                total_sft,
                amount: amountOf(total_sft, it.rate),
              };
            }),
          ),
        });
        // The audit trigger only sees updates and deletes, and created_by may name someone else.
        await tx.auditLog.create({
          data: {
            table_name: "Order",
            record_id: order.id,
            action: "INSERT",
            changed_by: user.id,
            user_name: user.username,
            new_data: { order_no: order.order_no, client_name: o.client_name, source: "bulk upload", csm_user_id: ownerId },
          },
        });
        saved.push({ id: order.id, order_no: order.order_no, client_name: o.client_name, created_by: ownerId });
      }
      return saved;
    }, { timeout: 120000 });

    for (const o of created) {
      await notifyRole("PRODUCTION", `New order ${o.order_no} created`, `Client: ${o.client_name}`, "info", o.id);
      if (o.created_by !== user.id) {
        await notifyUser(o.created_by, `New order ${o.order_no} for you`, `Client: ${o.client_name}. Uploaded by ${user.username}.`, "info", o.id).catch(() => {});
      }
    }
    return res.status(201).json({ orders: created.map(({ id, order_no, client_name }) => ({ id, order_no, client_name })) });
  } catch (err) {
    console.error("Bulk upload error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
