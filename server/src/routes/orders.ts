import { Router } from "express";
import type { OrderStatus, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma, computeItemFields, generateOrderNo, withAuditUser, decimalToNumber } from "../lib/prisma.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { serializeOrder, serializeOrders } from "../lib/serialize.js";
import {
  createOrderSchema,
  updateOrderSchema,
  invoiceSchema,
  closeOrderSchema,
} from "../lib/validators.js";
import {
  sendAdminEmail,
  orderChangeEmailHtml,
  invoiceMismatchEmailHtml,
} from "../lib/email.js";

const router = Router();

function buildWhere(req: Express.Request): Prisma.OrderWhereInput {
  const { order_no, client, store, status, section } = req.query;
  const where: Prisma.OrderWhereInput = {};

  if (typeof order_no === "string" && order_no) where.order_no = { contains: order_no, mode: "insensitive" };
  if (typeof client === "string" && client) where.client_name = { contains: client, mode: "insensitive" };
  if (typeof store === "string" && store) where.store_name = { contains: store, mode: "insensitive" };
  if (typeof status === "string" && status) where.status = status as OrderStatus;
  if (section === "active") where.status = "Active";
  if (section === "completed") where.status = "Completed";

  if (req.user!.role === "employee") {
    where.created_by = req.user!.id;
  }

  return where;
}

const orderInclude = { items: { orderBy: { s_no: "asc" as const } } };

router.get("/", authenticate, async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 50)));
  const where = buildWhere(req);

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return res.json({
    orders: serializeOrders(orders, req.user!.role),
    pagination: { page, limit, total },
  });
});

router.get("/export", authenticate, authorize("employee", "admin"), async (req, res) => {
  const where = buildWhere(req);
  const orders = await prisma.order.findMany({
    where,
    include: orderInclude,
    orderBy: { created_at: "desc" },
  });

  const rows: Record<string, string | number>[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      rows.push({
        "S.No": item.s_no,
        Date: order.date.toLocaleDateString("en-GB"),
        "Client Name": order.client_name,
        "Store Name": order.store_name,
        Location: order.location,
        "Order No": order.order_no,
        Media: item.media,
        "Size (W) in": decimalToNumber(item.width_inches),
        "Size (H) in": decimalToNumber(item.height_inches),
        Qty: decimalToNumber(item.qty),
        "Total SFT": decimalToNumber(item.total_sft),
        Rate: decimalToNumber(item.rate),
        Amount: decimalToNumber(item.amount),
        "PO Number": order.po_number ?? "",
        Remarks: order.remarks ?? "",
        Status: order.status,
        ...(req.user!.role === "admin" ? { "Created By": order.creator_name } : {}),
      });
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `orders_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return res.send(buf);
});

router.post("/", authenticate, authorize("employee"), async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const data = parsed.data;
  const user = req.user!;

  const order = await prisma.$transaction(async (tx) => {
    const order_no = await generateOrderNo(tx);
    return tx.order.create({
      data: {
        order_no,
        client_name: data.client_name,
        store_name: data.store_name,
        location: data.location,
        date: data.date,
        po_number: data.po_number ?? null,
        remarks: data.remarks ?? null,
        status: "Active",
        created_by: user.id,
        creator_name: user.name,
        items: {
          create: data.items.map((item, idx) => {
            const calc = computeItemFields(item.width_inches, item.height_inches, item.qty, item.rate);
            return {
              s_no: idx + 1,
              media: item.media,
              width_inches: item.width_inches,
              height_inches: item.height_inches,
              qty: item.qty,
              total_sft: calc.total_sft,
              rate: item.rate,
              amount: calc.amount,
            };
          }),
        },
      },
      include: orderInclude,
    });
  });

  return res.status(201).json({ order: serializeOrder(order, user.role) });
});

router.get("/:id", authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (req.user!.role === "employee" && order.created_by !== req.user!.id) {
    return res.status(403).json({ error: "You do not have permission to perform this action." });
  }
  return res.json({ order: serializeOrder(order, req.user!.role) });
});

function diffOrder(
  oldOrder: Awaited<ReturnType<typeof prisma.order.findUnique>> & { items: { id: number; s_no: number; media: string; width_inches: unknown; height_inches: unknown; qty: unknown; rate: unknown }[] },
  data: ReturnType<typeof updateOrderSchema.parse>,
) {
  const changes: Array<{ field: string; old: string; new: string }> = [];
  const headerFields = ["client_name", "store_name", "location", "po_number", "remarks"] as const;
  for (const f of headerFields) {
    const oldVal = String((oldOrder as Record<string, unknown>)[f] ?? "");
    const newVal = String(data[f] ?? "");
    if (oldVal !== newVal) changes.push({ field: f, old: oldVal, new: newVal });
  }
  return changes;
}

router.put("/:id", authenticate, authorize("employee", "admin"), async (req, res) => {
  const parsed = updateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const id = Number(req.params.id);
  const existing = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  if (req.user!.role === "employee" && existing.created_by !== req.user!.id) {
    return res.status(403).json({ error: "You do not have permission to perform this action." });
  }

  const data = parsed.data;
  const changes = req.user!.role === "employee" ? diffOrder(existing, data) : [];

  const order = await withAuditUser(req.user!.id, async (tx) => {
    await tx.orderItem.deleteMany({ where: { order_id: id } });
    const updated = await tx.order.update({
      where: { id },
      data: {
        client_name: data.client_name,
        store_name: data.store_name,
        location: data.location,
        date: data.date,
        po_number: data.po_number ?? null,
        remarks: data.remarks ?? null,
        items: {
          create: data.items.map((item, idx) => {
            const calc = computeItemFields(item.width_inches, item.height_inches, item.qty, item.rate);
            return {
              s_no: idx + 1,
              media: item.media,
              width_inches: item.width_inches,
              height_inches: item.height_inches,
              qty: item.qty,
              total_sft: calc.total_sft,
              rate: item.rate,
              amount: calc.amount,
            };
          }),
        },
      },
      include: orderInclude,
    });

    if (changes.length && req.user!.role === "employee") {
      for (const c of changes) {
        await tx.orderChangeLog.create({
          data: {
            order_id: id,
            changed_by: req.user!.id,
            field_changed: c.field,
            old_value: c.old,
            new_value: c.new,
          },
        });
      }
    }

    return updated;
  });

  if (changes.length && req.user!.role === "employee") {
    await sendAdminEmail(
      `Order ${order.order_no} edited`,
      orderChangeEmailHtml(order.order_no, req.user!.name, changes),
    );
  }

  return res.json({ order: serializeOrder(order, req.user!.role) });
});

router.delete("/:id", authenticate, authorize("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Order not found" });

  await withAuditUser(req.user!.id, async (tx) => {
    await tx.order.delete({ where: { id } });
  });

  return res.json({ ok: true });
});

router.put("/:id/invoice", authenticate, authorize("accountant"), async (req, res) => {
  const parsed = invoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "Completed") {
    return res.status(400).json({ error: "Order is already completed" });
  }

  const orderTotal = order.items.reduce((s, i) => s + decimalToNumber(i.amount), 0);
  const orderTotalStr = orderTotal.toFixed(2);
  const billStr = parsed.data.bill_amount.toFixed(2);
  const matched = orderTotalStr === billStr;
  const newStatus = matched ? "Completed" : "Pending";

  const updated = await prisma.order.update({
    where: { id },
    data: {
      invoice_no: parsed.data.invoice_no,
      bill_amount: parsed.data.bill_amount,
      status: newStatus,
    },
    include: orderInclude,
  });

  if (!matched) {
    const diff = (parsed.data.bill_amount - orderTotal).toFixed(2);
    await sendAdminEmail(
      `Invoice mismatch — ${order.order_no}`,
      invoiceMismatchEmailHtml(order.order_no, order.client_name, orderTotalStr, billStr, diff),
    );
  }

  return res.json({
    order: serializeOrder(updated, req.user!.role),
    matched,
    difference: matched ? 0 : Number((parsed.data.bill_amount - orderTotal).toFixed(2)),
  });
});

router.put("/:id/close", authenticate, authorize("admin"), async (req, res) => {
  const parsed = closeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "Pending") {
    return res.status(400).json({ error: "Only Pending orders can be closed" });
  }

  const updated = await withAuditUser(req.user!.id, async (tx) => {
    return tx.order.update({
      where: { id },
      data: {
        status: "Completed",
        remarks: parsed.data.remarks ?? order.remarks,
      },
      include: orderInclude,
    });
  });

  return res.json({ order: serializeOrder(updated, req.user!.role) });
});

export default router;
