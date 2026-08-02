import { serializeDecimals } from "../utils/serialize";
import { computeTotals } from "../utils/order-totals";
import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { generateOrderId } from "../utils/order-sequence";

import { notifyRole, notifyUser } from "../services/notifications.service";

import { sendOrderEditEmail, sendPendingInvoiceEmail, sendItemFlagEmail } from "../services/email.service";
import * as xlsx from "xlsx";


export const getOrders = async (req: Request, res: Response) => {
  try {
    const { section, order_no, client, store, status, q, page = "1", limit = "50" } = req.query;
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
    
    if (q) {
      where.OR = [
        { order_no: { contains: String(q), mode: "insensitive" } },
        { client_name: { contains: String(q), mode: "insensitive" } },
        { store_name: { contains: String(q), mode: "insensitive" } }
      ];
    }

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
      return res.status(200).json(serializeDecimals({ data: sanitizedOrders, total, page: Number(page) }));
    }

    
    const ordersWithTotal = orders.map((o: any) => {
      const { total_amount, loss_amount } = computeTotals(o.items);
      return { ...o, total_amount, loss_amount };
    });
    return res.status(200).json(serializeDecimals({ data: ordersWithTotal, total, page: Number(page) }));
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
      
      return res.status(200).json(serializeDecimals({
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
      }));
    }

    
    const { total_amount, loss_amount } = computeTotals(order.items);
    return res.status(200).json(serializeDecimals({ ...order, total_amount, loss_amount }));
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
    const isAdmin = user.role === "ADMIN";

    if (user.role === "EMPLOYEE" && remarks) {
      return res.status(403).json({ message: "Only an administrator can set order remarks." });
    }

    const ensureLookupValue = async (model: "client" | "media", name: string) => {
      try {
        const trimmed = name.trim();
        if (!trimmed) return;
        const existing = await (prisma as any)[model].findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
        if (!existing) await (prisma as any)[model].create({ data: { name: trimmed } });
      } catch (e) {
        console.error(`Lookup upsert failed for ${model}:`, e);
      }
    };

    ensureLookupValue("client", client_name);
    items.forEach((item: any) => ensureLookupValue("media", item.media));

    const processedItems = items.map((item: any, index: number) => {
      const w = Number(item.width_inches);
      const h = Number(item.height_inches);
      const q = Number(item.qty);
      const r = Number(item.rate);

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
        // Loss remarks: employees may PROPOSE (remarks_confirmed=false, still billable until admin approves);
        // an admin setting a remark auto-confirms it (excluded from the billable total).
        remarks: item.remarks ?? null,
        remarks_other_text: item.remarks === "Other" ? item.remarks_other_text : null,
        remarks_set_at: item.remarks ? new Date() : null,
        remarks_set_by: item.remarks ? user.id : null,
        remarks_confirmed: item.remarks ? isAdmin : false,
        remarks_confirmed_at: item.remarks && isAdmin ? new Date() : null,
        remarks_confirmed_by: item.remarks && isAdmin ? user.id : null,
      };
    });

    // If a non-admin proposed any loss remarks, flag the order for admin review.
    const hasProposedLoss = !isAdmin && processedItems.some((i: any) => i.remarks != null);

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
      "info",
      order.id
    );

    if (hasProposedLoss) {
      await notifyRole(
        "ADMIN",
        `Loss remark proposed on ${order.order_no}`,
        `${user.name} proposed a loss on one or more line items. Review and confirm to write it off.`,
        "warning",
        order.id
      );
    }

    const { total_amount, loss_amount } = computeTotals(order.items);
    return res.status(201).json(serializeDecimals({ ...order, total_amount, loss_amount }));
  
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
    const isAdmin = user.role === "ADMIN";

    const ensureLookupValue = async (model: "client" | "media", name: string) => {
      try {
        const trimmed = name.trim();
        if (!trimmed) return;
        const existing = await (prisma as any)[model].findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
        if (!existing) await (prisma as any)[model].create({ data: { name: trimmed } });
      } catch (e) {
        console.error(`Lookup upsert failed for ${model}:`, e);
      }
    };

    if (client_name) ensureLookupValue("client", client_name);
    if (items) {
      items.forEach((item: any) => {
        if (item.media) ensureLookupValue("media", item.media);
      });
    }

    const existingOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingOrder) return res.status(404).json({ message: "Order not found" });

    if (user.role === "EMPLOYEE" && existingOrder.created_by !== user.id) {
      console.log(`403 - Employee did not create order. Employee ID: ${user.id}, Order Created By: ${existingOrder.created_by}`);
      return res.status(403).json({ message: "Forbidden" });
    }

    if (user.role === "EMPLOYEE" && existingOrder.status === "Completed") {
      console.log(`403 - Completed order edit attempt`);
      return res.status(403).json({ message: "Completed orders cannot be edited" });
    }

    if (user.role === "EMPLOYEE" && remarks !== undefined && remarks !== (existingOrder.remarks ?? null)) {
      return res.status(403).json({ message: "Only an administrator can set order remarks." });
    }

    if (items && items.length > 0) {
      const oldItemsById = new Map(existingOrder.items.map((i: any) => [i.id, i]));
      const incomingIds = new Set(items.filter((i: any) => i.id).map((i: any) => i.id));

      if (user.role === "EMPLOYEE") {
        for (const oldItem of existingOrder.items) {
          if (!incomingIds.has(oldItem.id)) {
            console.log(`403 - Line item removed: ${oldItem.id}`);
            return res.status(403).json({ message: "Line items cannot be removed once saved." });
          }
        }
        for (const newItem of items) {
          if (!newItem.id) continue;
          const oldItem = oldItemsById.get(newItem.id);
          if (!oldItem) continue;
          const changed =
            newItem.media !== oldItem.media ||
            Number(newItem.width_inches) !== Number(oldItem.width_inches) ||
            Number(newItem.height_inches) !== Number(oldItem.height_inches) ||
            Number(newItem.qty) !== Number(oldItem.qty) ||
            Number(newItem.rate) !== Number(oldItem.rate) ||
            (newItem.remarks ?? null) !== (oldItem.remarks ?? null) ||
            (newItem.remarks_other_text ?? null) !== (oldItem.remarks_other_text ?? null);
          if (changed) {
            console.log(`403 - Existing line item edited: ${oldItem.id}. Values: ${JSON.stringify({ newItem, oldItem })}`);
            return res.status(403).json({ message: "Existing line items cannot be edited — flag it and add a corrected line instead." });
          }
        }
      }
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

    if (items) {
      const oldItems = existingOrder.items;
      items.forEach((newItem: any) => {
        const oldItem = newItem.id ? oldItems.find((i: any) => i.id === newItem.id) : undefined;
        if (!oldItem) {
          logChange(`Item (new)`, "—", `${newItem.media}`);
          return;
        }
        const fields: [string, string, string, string][] = [
          ["Media", "media", String(oldItem.media), String(newItem.media)],
          ["Width (in)", "width_inches", Number(oldItem.width_inches).toFixed(2), Number(newItem.width_inches).toFixed(2)],
          ["Height (in)", "height_inches", Number(oldItem.height_inches).toFixed(2), Number(newItem.height_inches).toFixed(2)],
          ["Qty", "qty", Number(oldItem.qty).toFixed(2), Number(newItem.qty).toFixed(2)],
          ["Rate (per Sq.Ft.)", "rate", Number(oldItem.rate).toFixed(2), Number(newItem.rate).toFixed(2)],
        ];
        fields.forEach(([label, , oldVal, newVal]) => {
          if (oldVal !== newVal) {
            logChange(`Item ${oldItem.s_no} – ${label}`, oldVal, newVal);
          }
        });
      });
    }

    let proposedLossDuringUpdate = false;
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
        const oldItemsById = new Map(existingOrder.items.map((i: any) => [i.id, i]));
        let nextSNo = existingOrder.items.length > 0 ? Math.max(...existingOrder.items.map((i: any) => i.s_no)) + 1 : 1;

        for (const newItem of items) {
          const w = Number(newItem.width_inches);
          const h = Number(newItem.height_inches);
          const q = Number(newItem.qty);
          const r = Number(newItem.rate);
          const total_sft = Number(((w * h) / 144) * q).toFixed(2);
          const amount = Number(parseFloat(total_sft) * r).toFixed(2);

          if (newItem.id && oldItemsById.has(newItem.id)) {
            const oldItem = oldItemsById.get(newItem.id)!;
            const remarkChanged = (newItem.remarks ?? null) !== (oldItem?.remarks ?? null);
            // Only admins can reach here with a changed remark (employees are blocked by the
            // append-only check above). An admin changing a remark sets AND confirms it.
            const adminRemarkUpdate = isAdmin && remarkChanged
              ? {
                  remarks_set_at: newItem.remarks ? new Date() : null,
                  remarks_set_by: newItem.remarks ? user.id : null,
                  remarks_confirmed: newItem.remarks ? true : false,
                  remarks_confirmed_at: newItem.remarks ? new Date() : null,
                  remarks_confirmed_by: newItem.remarks ? user.id : null,
                }
              : {};
            await tx.orderItem.update({
              where: { id: newItem.id },
              data: {
                media: newItem.media, width_inches: w, height_inches: h,
                qty: q, total_sft: parseFloat(total_sft), rate: r, amount: parseFloat(amount),
                remarks: newItem.remarks ?? null,
                remarks_other_text: newItem.remarks === "Other" ? newItem.remarks_other_text : null,
                ...adminRemarkUpdate,
              },
            });
          } else {
            await tx.orderItem.create({
              data: {
                order_id: id, s_no: nextSNo++, media: newItem.media,
                width_inches: w, height_inches: h, qty: q,
                total_sft: parseFloat(total_sft), rate: r, amount: parseFloat(amount),
                // Loss remarks: employees propose (unconfirmed, still billable); admins auto-confirm.
                remarks: newItem.remarks ?? null,
                remarks_other_text: newItem.remarks === "Other" ? newItem.remarks_other_text : null,
                remarks_set_at: newItem.remarks ? new Date() : null,
                remarks_set_by: newItem.remarks ? user.id : null,
                remarks_confirmed: newItem.remarks ? isAdmin : false,
                remarks_confirmed_at: newItem.remarks && isAdmin ? new Date() : null,
                remarks_confirmed_by: newItem.remarks && isAdmin ? user.id : null,
              },
            });
            if (newItem.remarks && !isAdmin) proposedLossDuringUpdate = true;
          }
        }
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

    if (proposedLossDuringUpdate) {
      await notifyRole(
        "ADMIN",
        `Loss remark proposed on ${existingOrder.order_no}`,
        `${user.name} proposed a loss on a line item. Review and confirm to write it off.`,
        "warning",
        id
      );
    }

    const { total_amount, loss_amount } = computeTotals(updatedOrder?.items);
    return res.status(200).json(serializeDecimals({ ...updatedOrder, total_amount, loss_amount }));
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
    return res.status(200).json(serializeDecimals({ message: "Order deleted" }));
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

    // Bill only against the chargeable items — confirmed losses are excluded.
    const orderTotal = computeTotals(order.items).total_amount;

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
        isMatch ? "success" : "warning",
        order.id
      );
    }

    return res.status(200).json(serializeDecimals(updated));
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

    return res.status(200).json(serializeDecimals(updated));
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const exportOrders = async (req: Request, res: Response) => {
  try {
    const { section, status, q } = req.query;
    const user = req.user!;
    const where: any = {};
    
    if (user.role === "EMPLOYEE") {
      where.created_by = user.id;
    }

    if (section === "active") where.status = { in: ["Active", "Pending"] };
    if (section === "completed") where.status = "Completed";
    if (status) where.status = status;

    if (q) {
      where.OR = [
        { order_no: { contains: String(q), mode: "insensitive" } },
        { client_name: { contains: String(q), mode: "insensitive" } },
        { store_name: { contains: String(q), mode: "insensitive" } }
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: true, creator: true },
      orderBy: { order_no: "asc" },
    });

    const rows: any[] = [];
    for (const order of orders) {
      // Billable total excludes confirmed losses; used for the Pending Amount column.
      const total = computeTotals(order.items).total_amount;
      for (const item of order.items) {
        const lossStatus = item.remarks == null ? "" : (item.remarks_confirmed ? "Loss (confirmed)" : "Loss (proposed)");
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
          "Remarks": item.remarks === "Other" ? (item.remarks_other_text || "") : (item.remarks || ""),
          "Loss": lossStatus,
          "Closure Remarks": order.remarks === "Other" ? (order.remarks_other_text || "") : (order.remarks || ""),
          "Status": order.status,
        };
        if (user.role === "ADMIN" || user.role === "ACCOUNTS") {
          row["Invoice No"] = order.invoice_no || "";
          row["Bill Amount"] = order.bill_amount !== null ? Number(order.bill_amount) : "";
          row["Pending Amount"] = (order.status === "Pending" && order.bill_amount !== null) ? total - Number(order.bill_amount) : (order.status === "Pending" && order.bill_amount === null ? total : "");
        }
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

    return res.status(200).json(serializeDecimals(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

import { flagItemSchema, itemLossRemarkSchema } from "../utils/validators";

export const flagOrderItem = async (req: Request, res: Response) => {
  try {
    const parseResult = flagItemSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    const { is_flagged, flag_reason } = parseResult.data;
    const orderId = parseInt(req.params.orderId as string, 10);
    const itemId = parseInt(req.params.itemId as string, 10);
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (user.role === "EMPLOYEE" && order.created_by !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Capture who raised the flag before we clear it (needed to notify them on an admin reject).
    const priorItem = await prisma.orderItem.findUnique({ where: { id: itemId } });

    const item = await prisma.orderItem.update({
      where: { id: itemId },
      data: is_flagged
        ? { is_flagged: true, flag_reason, flagged_at: new Date(), flagged_by: user.id }
        : { is_flagged: false, flag_reason: null, flagged_at: null, flagged_by: null },
    });

    const itemLabel = `#${item.s_no} — ${item.media} (${Number(item.width_inches)}x${Number(item.height_inches)} in, qty ${Number(item.qty)})`;

    if (is_flagged) {
      // Raising a flag notifies the admin — this is the employee's append-only correction channel.
      await sendItemFlagEmail(order.order_no, user.name, itemLabel, flag_reason || "");
      await notifyRole(
        "ADMIN",
        `Line item flagged on ${order.order_no}`,
        `${user.name} flagged item ${itemLabel}: ${flag_reason || "(no note)"}`,
        "warning",
        order.id
      );
    } else if (user.role === "ADMIN" && priorItem?.flagged_by && priorItem.flagged_by !== user.id) {
      // Admin rejected a flag someone else raised — let the employee know it was reviewed and dismissed.
      await notifyUser(
        priorItem.flagged_by,
        `Flag rejected on ${order.order_no}`,
        `${user.name} reviewed and rejected your flag on item ${itemLabel}.`,
        "warning",
        order.id
      );
    }

    return res.status(200).json(serializeDecimals(item));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const setItemLossRemark = async (req: Request, res: Response) => {
  try {
    const parseResult = itemLossRemarkSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    const { remarks, remarks_other_text } = parseResult.data;
    const itemId = parseInt(req.params.itemId as string, 10);
    const user = req.user!;

    // An admin setting a remark confirms it as a real loss (excluded from the billable total).
    // Clearing the remark rejects it — the line becomes chargeable again.
    const item = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      return tx.orderItem.update({
        where: { id: itemId },
        data: {
          remarks,
          remarks_other_text: remarks === "Other" ? remarks_other_text : null,
          remarks_set_at: remarks ? new Date() : null,
          remarks_set_by: remarks ? user.id : null,
          remarks_confirmed: remarks ? true : false,
          remarks_confirmed_at: remarks ? new Date() : null,
          remarks_confirmed_by: remarks ? user.id : null,
        },
      });
    });
    return res.status(200).json(serializeDecimals(item));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
