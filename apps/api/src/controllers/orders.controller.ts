import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { generateOrderId } from "../utils/order-sequence";

import { notifyRole, notifyUser } from "../services/notifications.service";

import { sendOrderEditEmail, sendPendingInvoiceEmail } from "../services/email.service";
import * as xlsx from "xlsx";


export const getOrders = async (req: Request, res: Response) => {
  try {
    const { section, order_no, client, store, status, page = "1", limit = "50" } = req.query;
    const user = req.user!;

    const where: any = {};
    if (user.role === "EMPLOYEE") {
      where.created_by = user.id;
    }

    if (section === "active") where.status = { in: ["Active", "Pending"] };
    if (section === "completed") where.status = "Completed";

    if (order_no) where.order_no = { contains: String(order_no), mode: "insensitive" };
    if (client) where.client_name = { contains: String(client), mode: "insensitive" };
    if (store) where.store_name = { contains: String(store), mode: "insensitive" };
    if (status) where.status = status;

    if (user.role === "PRODUCTION") {
      where.status = "Active";
    }

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { created_at: "desc" },
        include: { items: true },
      }),
      prisma.order.count({ where }),
    ]);

    // Role-based field stripping for PRODUCTION
    if (user.role === "PRODUCTION") {
      const sanitizedOrders = orders.map((o: any) => ({
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        store_name: o.store_name,
        location: o.location,
        status: o.status,
        date: o.date,
        items: o.items.map((i: any) => ({
          id: i.id,
          s_no: i.s_no,
          media: i.media,
          width_inches: i.width_inches,
          height_inches: i.height_inches,
          qty: i.qty,
          total_sft: i.total_sft,
        })),
      }));
      return res.status(200).json({ data: sanitizedOrders, total, page: Number(page) });
    }

    return res.status(200).json({ data: orders, total, page: Number(page) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getOrder = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (req.user!.role === "EMPLOYEE" && order.created_by !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (req.user!.role === "PRODUCTION") {
      if (order.status !== "Active") {
        return res.status(403).json({ message: "Forbidden" });
      }
      return res.status(200).json({
        id: order.id,
        order_no: order.order_no,
        client_name: order.client_name,
        store_name: order.store_name,
        location: order.location,
        status: order.status,
        date: order.date,
        items: order.items.map((i: any) => ({
          id: i.id,
          s_no: i.s_no,
          media: i.media,
          width_inches: i.width_inches,
          height_inches: i.height_inches,
          qty: i.qty,
          total_sft: i.total_sft,
        })),
      });
    }

    return res.status(200).json(order);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

import { createOrderSchema, updateOrderSchema, invoiceSchema, closeOrderSchema, forceCloseOrderSchema } from "../utils/validators";

export const createOrder = async (req: Request, res: Response) => {
  try {
    const parseResult = createOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    const { client_name, store_name, location, po_number, items, remarks, remarks_other_text } = parseResult.data;
    const user = req.user!;

    const processedItems = items.map((item: any, index: number) => {
      const w = parseFloat(item.width_inches);
      const h = parseFloat(item.height_inches);
      const q = parseFloat(item.qty);
      const r = parseFloat(item.rate);

      if (w <= 0 || h <= 0 || q <= 0 || r <= 0) {
        throw new Error("Item dimensions, qty, and rate must be positive numbers.");
      }

      const total_sft = Number(((w * h) / 144) * q).toFixed(2);
      const amount = Number(parseFloat(total_sft) * r).toFixed(2);

      return {
        s_no: index + 1,
        media: item.media,
        width_inches: w,
        height_inches: h,
        qty: q,
        total_sft: parseFloat(total_sft),
        rate: r,
        amount: parseFloat(amount),
      };
    });

    const order_no = await generateOrderId();

    const order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      return tx.order.create({
        data: {
          order_no,
          client_name,
          store_name,
          location,
          po_number,
          created_by: user.id,
          creator_name: user.name,
          status: "Active",
          remarks,
          remarks_other_text,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });
    });

    
    await notifyRole(
      "PRODUCTION",
      `New order ${order.order_no} created`,
      `Client: ${order.client_name}`,
      "info"
    );
    return res.status(201).json(order);
  
  } catch (err: any) {
    console.error(err);
    if (err.message.includes("Item dimensions")) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateOrder = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = updateOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    const { client_name, store_name, location, po_number, items, remarks, remarks_other_text } = parseResult.data;
    const user = req.user!;

    const existingOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingOrder) return res.status(404).json({ message: "Order not found" });

    if (user.role === "EMPLOYEE" && existingOrder.created_by !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (user.role === "EMPLOYEE" && existingOrder.status === "Completed") {
      return res.status(403).json({ message: "Completed orders cannot be edited" });
    }

    const changes: any[] = [];
    const logChange = (field: string, oldVal: string, newVal: string) => {
      if (oldVal !== newVal) {
        changes.push({ field, oldValue: oldVal, newValue: newVal });
      }
    };

    if (client_name !== undefined) logChange("Client Name", existingOrder.client_name, client_name);
    if (store_name !== undefined) logChange("Store Name", existingOrder.store_name, store_name);
    if (location !== undefined) logChange("Location", existingOrder.location, location);
    if (po_number !== undefined) logChange("PO Number", existingOrder.po_number || "", po_number || "");

    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;

      // Update header
      const order = await tx.order.update({
        where: { id },
        data: {
          client_name: client_name !== undefined ? client_name : undefined,
          store_name: store_name !== undefined ? store_name : undefined,
          location: location !== undefined ? location : undefined,
          po_number: po_number !== undefined ? po_number : undefined,
          remarks: remarks !== undefined ? remarks : undefined,
          remarks_other_text: remarks_other_text !== undefined ? remarks_other_text : undefined,
        },
      });

      if (items && items.length > 0) {
        await tx.orderItem.deleteMany({ where: { order_id: id } });

        const processedItems = items.map((item: any, index: number) => {
          const w = parseFloat(item.width_inches);
          const h = parseFloat(item.height_inches);
          const q = parseFloat(item.qty);
          const r = parseFloat(item.rate);
          const total_sft = Number(((w * h) / 144) * q).toFixed(2);
          const amount = Number(parseFloat(total_sft) * r).toFixed(2);
          return {
            order_id: id,
            s_no: index + 1,
            media: item.media,
            width_inches: w,
            height_inches: h,
            qty: q,
            total_sft: parseFloat(total_sft),
            rate: r,
            amount: parseFloat(amount),
          };
        });

        await tx.orderItem.createMany({ data: processedItems });
        logChange("Items", "Previous items", "New updated items");
      }

      if (changes.length > 0 && user.role === "EMPLOYEE") {
        await tx.orderChangeLog.createMany({
          data: changes.map((c) => ({
            order_id: id,
            changed_by: user.id,
            field_changed: c.field,
            old_value: String(c.oldValue),
            new_value: String(c.newValue),
          })),
        });
      }

      return tx.order.findUnique({ where: { id }, include: { items: true } });
    });

    if (changes.length > 0 && user.role === "EMPLOYEE") {
      await sendOrderEditEmail(existingOrder.order_no, user.name, changes);
    }

    return res.status(200).json(updatedOrder);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteOrder = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${req.user!.id.toString()}, true)`;
      await tx.order.delete({ where: { id } });
    });
    return res.status(200).json({ message: "Order deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const reconcileInvoice = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = invoiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    const { invoice_no, bill_amount } = parseResult.data;
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status === "Completed") {
      return res.status(400).json({ message: "Order is already completed" });
    }
    
    if (order.invoice_no) {
      return res.status(400).json({ message: "Invoice already submitted for this order; corrections must go through an order edit." });
    }

    const orderTotal = order.items.reduce((sum: any, item: any) => sum + Number(item.amount), 0);
    
    // Reject overpayment
    if (Number(bill_amount) > Number(orderTotal)) {
      return res.status(400).json({ message: "Bill amount cannot exceed order total." });
    }

    const isMatch = Number(bill_amount).toFixed(2) === orderTotal.toFixed(2);
    const newStatus = isMatch ? "Completed" : "Pending";

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      return tx.order.update({
        where: { id },
        data: {
          invoice_no,
          bill_amount,
          status: newStatus,
        },
      });
    });

    if (!isMatch) {
      await sendPendingInvoiceEmail(order.order_no, order.client_name, orderTotal, bill_amount);
    }
    
    if (order.created_by) {
      await notifyUser(
        order.created_by,
        `Order ${order.order_no} Billed`,
        isMatch ? `Fully billed at ${bill_amount}` : `Partially billed at ${bill_amount}`,
        isMatch ? "success" : "warning"
      );
    }

    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const closeOrder = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = closeOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    const { remarks, remarks_other_text } = parseResult.data;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "Pending") {
      return res.status(400).json({ message: "Only pending orders can be closed." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${req.user!.id.toString()}, true)`;
      return tx.order.update({
        where: { id },
        data: {
          status: "Completed",
          remarks,
          remarks_other_text: remarks_other_text || null,
        },
      });
    });

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const exportOrders = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const where: any = {};
    if (user.role === "EMPLOYEE") {
      where.created_by = user.id;
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: true, creator: true },
      orderBy: { created_at: "desc" },
    });

    const rows: any[] = [];
    for (const order of orders) {
      for (const item of order.items) {
        const row: any = {
          "S.No": item.s_no,
          "Date": order.date.toLocaleDateString("en-IN"),
          "Client Name": order.client_name,
          "Store Name": order.store_name,
          "Location": order.location,
          "Order No": order.order_no,
          "Media": item.media,
          "Size (W) in": Number(item.width_inches),
          "Size (H) in": Number(item.height_inches),
          "Qty": Number(item.qty),
          "Total SFT": Number(item.total_sft),
          "Rate": Number(item.rate),
          "Amount": Number(item.amount),
          "PO Number": order.po_number || "",
          "Remarks": order.remarks === "Other" ? (order.remarks_other_text || "") : (order.remarks || ""),
          "Status": order.status,
        };
        if (user.role === "ADMIN") {
          row["Created By"] = order.creator_name;
        }
        rows.push(row);
      }
    }

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Orders");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename=orders_${new Date().toISOString().split("T")[0]}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const forceCloseOrder = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = forceCloseOrderSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    
    const { remarks, remarks_other_text } = parseResult.data;
    
    const order = await prisma.order.findUnique({ where: { id } });
    
    if (!order) return res.status(404).json({ message: "Order not found" });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${req.user!.id.toString()}, true)`;
      return tx.order.update({
        where: { id },
        data: {
          status: "Completed",
          remarks,
          remarks_other_text,
        },
      });
    });

    return res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
