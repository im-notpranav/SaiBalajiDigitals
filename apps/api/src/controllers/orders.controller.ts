import { serializeDecimals } from "../utils/serialize";
import { computeTotals } from "../utils/order-totals";
import { isClosed, isCsmEditable, isHeaderEditable, isBillingStarted, OPEN_STATUSES, CLOSED_STATUSES } from "../utils/order-status";
import { currentStage, lastProducedAt, businessDaysBetween } from "../utils/order-stage";
import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { generateOrderId } from "../utils/order-sequence";
import { recomputeOrderStatus, rollupOrder, storeLabelOf, storeLocationOf } from "../utils/order-derive";

import { notifyRole, notifyUser } from "../services/notifications.service";

import {
  sendOrderCreatedEmail,
  sendOrderEditEmail,
  sendPendingInvoiceEmail,
  sendItemFlagEmail,
  sendBillingEditEmail,
  sendStatusTransitionEmail,
  sendExcelEmail,
  adminEmail,
  type OrderSummary,
  type OrderItemSummary,
  type FieldChange,
} from "../services/email.service";
import * as xlsx from "xlsx";
import { sanitizeZodErrors } from "../utils/sanitize-errors";


export const getOrders = async (req: Request, res: Response) => {
  try {
    const { section, order_no, client, store, status, q, page = "1", limit = "50" } = req.query;
    const user = req.user!;

    const where: any = {};
    if (user.role === "CSM") {
      where.created_by = user.id;
    }

    // "Active" = still in flight (incl. installed / billed-but-unpaid); "completed" =
    // closed either by payment received or by an admin closure.
    if (section === "active") where.status = { in: OPEN_STATUSES };
    if (section === "completed") where.status = { in: CLOSED_STATUSES };

    if (order_no) where.order_no = { contains: String(order_no), mode: "insensitive" };
    if (client) where.client_name = { contains: String(client), mode: "insensitive" };
    if (status) where.status = status;

    // A store match may sit on any of the order's stores. Collected under AND so that a
    // store filter and a free-text search can both apply instead of overwriting each other.
    const storeMatch = (term: string) => [
      { store_name: { contains: term, mode: "insensitive" } },
      { stores: { some: { store_name: { contains: term, mode: "insensitive" } } } },
    ];
    const andClauses: any[] = [];
    if (store) andClauses.push({ OR: storeMatch(String(store)) });
    if (q) {
      andClauses.push({
        OR: [
          { order_no: { contains: String(q), mode: "insensitive" } },
          { client_name: { contains: String(q), mode: "insensitive" } },
          ...storeMatch(String(q)),
        ],
      });
    }
    if (andClauses.length > 0) where.AND = andClauses;

    if (user.role === "PRODUCTION") {
      where.status = "Active";
      // Production users only see orders that have at least one item assigned to them.
      where.items = { some: { assignments: { some: { user_id: user.id } } } };
    }

    if (user.role === "PRODUCTION_MANAGER") {
      where.status = { in: OPEN_STATUSES };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { created_at: "desc" },
        include: {
          items: { include: { assignments: { include: { user: { select: { id: true, name: true } } } } } },
          stores: { select: { id: true, s_no: true, store_name: true, location: true, installed_at: true, invoice_id: true }, orderBy: { s_no: "asc" } },
          _count: { select: { stores: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    // Role-based field stripping for PRODUCTION — no financials, and only their own items.
    if (user.role === "PRODUCTION") {
      const sanitizedOrders = orders.map((o: any) => ({
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        store_name: storeLabelOf(o),
        location: storeLocationOf(o),
        stores: o.stores,
        store_count: o._count.stores,
        status: o.status,
        date: o.date,
        items: o.items
          .filter((i: any) => i.assignments.some((a: any) => a.user_id === user.id))
          .map((i: any) => ({
            id: i.id,
            order_store_id: i.order_store_id,
            s_no: i.s_no,
            media: i.media,
            width_inches: i.width_inches,
            height_inches: i.height_inches,
            qty: i.qty,
            total_sft: i.total_sft,
            assignments: i.assignments,
            // This production user's own completion state, for their queue.
            my_assignment_completed: i.assignments.find((a: any) => a.user_id === user.id)?.completed ?? false,
            production_completed: i.production_completed,
            production_completed_at: i.production_completed_at,
            is_flagged: i.is_flagged,
            flag_reason: i.flag_reason,
          })),
      }));
      return res.status(200).json(serializeDecimals({ data: sanitizedOrders, total, page: Number(page) }));
    }

    
    const ordersWithTotal = orders.map((o: any) => {
      const { total_amount, loss_amount } = computeTotals(o.items);
      const { _count, ...rest } = o;
      return { ...rest, store_count: _count.stores, total_amount, loss_amount };
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
      include: {
        // The flat item list stays: the export, dashboards and production queue all read it.
        items: { include: { assignments: { include: { user: { select: { id: true, name: true } } } } } },
        stores: {
          include: {
            items: { include: { assignments: { include: { user: { select: { id: true, name: true } } } } }, orderBy: { s_no: "asc" } },
            installer: { select: { id: true, name: true } },
          },
          orderBy: { s_no: "asc" },
        },
        invoices: { orderBy: { id: "asc" } },
      },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // A CSM may open any order, not just their own: header fields (store, location, PO)
    // are editable by any active CSM, and a stand-in cannot enter a PO on an order they
    // cannot open. Their *list* stays scoped to their own orders — see getOrders.
    // Line-item and installation actions remain creator-only.

    if (req.user!.role === "PRODUCTION") {
      if (order.status !== "Active") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const myItems = order.items.filter((i: any) => i.assignments.some((a: any) => a.user_id === req.user!.id));
      if (myItems.length === 0) {
        return res.status(403).json({ message: "Forbidden" });
      }

      return res.status(200).json(serializeDecimals({
        id: order.id,
        order_no: order.order_no,
        client_name: order.client_name,
        store_name: storeLabelOf(order),
        location: storeLocationOf(order),
        stores: order.stores.map((s: any) => ({ id: s.id, s_no: s.s_no, store_name: s.store_name, location: s.location })),
        status: order.status,
        date: order.date,
        items: myItems.map((i: any) => ({
          id: i.id,
          order_store_id: i.order_store_id,
          s_no: i.s_no,
          media: i.media,
          width_inches: i.width_inches,
          height_inches: i.height_inches,
          qty: i.qty,
          total_sft: i.total_sft,
          assignments: i.assignments,
          my_assignment_completed: i.assignments.find((a: any) => a.user_id === req.user!.id)?.completed ?? false,
          production_completed: i.production_completed,
          production_completed_at: i.production_completed_at,
          is_flagged: i.is_flagged,
          flag_reason: i.flag_reason,
        })),
      }));
    }

    
    const { total_amount, loss_amount } = computeTotals(order.items);
    // Each store carries the billable total of its own items — that is what an invoice
    // covering this store is reconciled against.
    const stores = order.stores.map((s: any) => ({ ...s, ...computeTotals(s.items) }));
    return res.status(200).json(serializeDecimals({ ...order, stores, total_amount, loss_amount }));
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

import { createOrderSchema, updateOrderSchema, updateOrderDetailsSchema, updateStoreSchema, addStoreSchema, invoiceSchema, closeOrderSchema, forceCloseOrderSchema, paymentSchema } from "../utils/validators";

export const createOrder = async (req: Request, res: Response) => {
  try {
    const parseResult = createOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { client_name, po_number, stores, remarks, remarks_other_text } = parseResult.data;
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";

    if (user.role === "CSM" && remarks) {
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
    stores.forEach((s) => s.items.forEach((item: any) => ensureLookupValue("media", item.media)));

    // Items are processed per store; s_no restarts at 1 inside each store.
    const processedByStore = stores.map((store) =>
      store.items.map((item: any, index: number) => {
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
      })
    );

    // If a non-admin proposed any loss remarks, flag the order for admin review.
    const hasProposedLoss = !isAdmin && processedByStore.some((si) => si.some((i: any) => i.remarks != null));

    const order_no = await generateOrderId();

    const order = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const created = await tx.order.create({
        data: {
          order_no,
          client_name,
          po_number,
          created_by: user.id,
          creator_name: user.name,
          status: "Active",
          remarks,
          remarks_other_text,
          stores: {
            create: stores.map((s, index) => ({
              s_no: index + 1,
              store_name: s.store_name,
              location: s.location,
              po_number: s.po_number ?? null,
            })),
          },
        },
        include: { stores: { orderBy: { s_no: "asc" } } },
      });
      // s_no ascending matches the order the stores were supplied in, so each store's
      // items line up by index. Items carry both ids; the composite key keeps them from
      // ever disagreeing.
      await tx.orderItem.createMany({
        data: created.stores.flatMap((storeRow, index) =>
          processedByStore[index]!.map((item: any) => ({
            ...item,
            order_id: created.id,
            order_store_id: storeRow.id,
          }))
        ),
      });
      return tx.order.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: true, stores: { orderBy: { s_no: "asc" } } },
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

    // Email the employee who created the order (if they have an email on file)
    const creator = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
    if (creator?.email) {
      const summary: OrderSummary = {
        order_no: order.order_no,
        client_name: order.client_name,
        store_name: storeLabelOf(order),
        location: storeLocationOf(order),
        po_number: order.po_number,
        date: order.date.toLocaleDateString("en-IN"),
        total_amount: total_amount.toFixed(2),
        status: order.status,
      };
      const emailItems: OrderItemSummary[] = order.items.map((i: any) => ({
        s_no: i.s_no,
        media: i.media,
        width: Number(i.width_inches).toString(),
        height: Number(i.height_inches).toString(),
        qty: Number(i.qty).toString(),
        sft: Number(i.total_sft).toFixed(2),
        rate: Number(i.rate).toFixed(2),
        amount: Number(i.amount).toFixed(2),
      }));
      sendOrderCreatedEmail(creator.email, user.name, summary, emailItems);
    }

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
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    // Header fields are accepted for backward compatibility but handled elsewhere; see
    // the guard below. This endpoint is line items only.
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

    if (items) {
      items.forEach((item: any) => {
        if (item.media) ensureLookupValue("media", item.media);
      });
    }

    const existingOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true, stores: { orderBy: { s_no: "asc" } } },
    });

    if (!existingOrder) return res.status(404).json({ message: "Order not found" });

    // Line items stay creator-restricted. Header fields do not — see updateOrderDetails.
    if (user.role === "CSM" && existingOrder.created_by !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (user.role === "CSM" && !isCsmEditable(existingOrder.status)) {
      return res.status(403).json({ message: "Line items can only be added before billing starts." });
    }

    if (user.role === "CSM" && remarks !== undefined && remarks !== (existingOrder.remarks ?? null)) {
      return res.status(403).json({ message: "Only an administrator can set order remarks." });
    }

    // Header fields have their own endpoints. Rejected loudly rather than ignored:
    // silently dropping a header edit is how these changes get lost.
    if (client_name !== undefined || store_name !== undefined || location !== undefined || po_number !== undefined) {
      return res.status(400).json({
        message:
          "Client, store, location and PO are no longer edited here. Use PATCH /api/orders/:id/details for the order header, or PATCH /api/orders/:orderId/stores/:storeId for a store.",
      });
    }

    // Every store this order has, so an item can be appended to the right one.
    const storeById = new Map(existingOrder.stores.map((s) => [s.id, s]));
    const defaultStoreId = existingOrder.stores[0]?.id;
    if (items && items.length > 0 && defaultStoreId === undefined) {
      return res.status(409).json({ message: "This order has no store to attach line items to." });
    }
    if (items) {
      for (const it of items as any[]) {
        if (it.store_id !== undefined && !storeById.has(it.store_id)) {
          return res.status(400).json({ message: `Store ${it.store_id} does not belong to this order.` });
        }
      }
    }

    if (items && items.length > 0) {
      const oldItemsById = new Map(existingOrder.items.map((i: any) => [i.id, i]));
      const incomingIds = new Set(items.filter((i: any) => i.id).map((i: any) => i.id));

      if (user.role === "CSM") {
        for (const oldItem of existingOrder.items) {
          if (!incomingIds.has(oldItem.id)) {
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
            return res.status(403).json({ message: "Existing line items cannot be edited — flag it and add a corrected line instead." });
          }
        }
      }

      // Phase 3: no silent adjustments. An admin changing an existing item's billable
      // figures must attach a loss remark to that line explaining the change.
      if (isAdmin) {
        for (const newItem of items) {
          if (!newItem.id) continue;
          const oldItem: any = oldItemsById.get(newItem.id);
          if (!oldItem) continue;
          const amountChanged =
            Number(newItem.width_inches) !== Number(oldItem.width_inches) ||
            Number(newItem.height_inches) !== Number(oldItem.height_inches) ||
            Number(newItem.qty) !== Number(oldItem.qty) ||
            Number(newItem.rate) !== Number(oldItem.rate);
          if (amountChanged && !newItem.remarks) {
            return res.status(400).json({
              message: `A remark is required to adjust the amount on item #${oldItem.s_no}. Select a reason for the change.`,
            });
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

      // Order-level remarks are the only header field still settled here; client, store,
      // location and PO have their own endpoints.
      if (remarks !== undefined || remarks_other_text !== undefined) {
        await tx.order.update({
          where: { id },
          data: {
            remarks: remarks !== undefined ? remarks : undefined,
            remarks_other_text: remarks_other_text !== undefined ? remarks_other_text : undefined,
          },
        });
      }

      if (items && items.length > 0) {
        const oldItemsById = new Map(existingOrder.items.map((i: any) => [i.id, i]));
        // s_no is 1-based within each store, so numbering continues per store, not per order.
        const nextSNoByStore = new Map<number, number>();
        for (const s of existingOrder.stores) {
          const own = existingOrder.items.filter((i: any) => i.order_store_id === s.id);
          nextSNoByStore.set(s.id, own.length > 0 ? Math.max(...own.map((i: any) => i.s_no)) + 1 : 1);
        }

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
            const targetStoreId = newItem.store_id ?? defaultStoreId!;
            const sNo = nextSNoByStore.get(targetStoreId) ?? 1;
            nextSNoByStore.set(targetStoreId, sNo + 1);
            await tx.orderItem.create({
              data: {
                order_id: id, order_store_id: targetStoreId, s_no: sNo, media: newItem.media,
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

      if (changes.length > 0 && user.role === "CSM") {
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

      // Line-item changes move the billable total, which can flip an order between
      // BillingCompleted and Pending.
      await recomputeOrderStatus(tx, id);
      return tx.order.findUnique({ where: { id }, include: { items: true } });
    });

    if (changes.length > 0 && user.role === "CSM") {
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

// ---------------------------------------------------------------------------------------
// Header edits.
//
// Deliberately separate from updateOrder: line items are append-only and freeze once
// billing starts, but a store name may need correcting and a PO usually only arrives
// *after* the invoice is raised. One gate cannot serve both.
// ---------------------------------------------------------------------------------------

/** Shared by every header edit: persist the change log and notify, exactly as updateOrder does. */
const recordHeaderChanges = async (
  tx: any,
  orderId: number,
  user: { id: number; role: string; name: string },
  changes: { field: string; oldValue: string; newValue: string }[]
) => {
  if (changes.length === 0 || user.role !== "CSM") return;
  await tx.orderChangeLog.createMany({
    data: changes.map((c) => ({
      order_id: orderId,
      changed_by: user.id,
      field_changed: c.field,
      old_value: c.oldValue,
      new_value: c.newValue,
    })),
  });
};

const collectChanges = () => {
  const changes: { field: string; oldValue: string; newValue: string }[] = [];
  return {
    changes,
    log: (field: string, oldVal: string, newVal: string) => {
      if (oldVal !== newVal) changes.push({ field, oldValue: oldVal, newValue: newVal });
    },
  };
};

/** PATCH /api/orders/:id/details — client name, job PO and order remarks. No line items. */
export const updateOrderDetails = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = updateOrderDetailsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { client_name, po_number, remarks, remarks_other_text } = parseResult.data;
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // No creator check: any active CSM may correct a header field. If the CSM who raised
    // the order is on leave, the PO still has to get in.
    if (!isAdmin && !isHeaderEditable(order.status)) {
      return res.status(403).json({ message: "This order is settled. Ask an administrator to change it." });
    }

    if (!isAdmin && client_name !== undefined && client_name !== order.client_name && isBillingStarted(order.status)) {
      return res.status(403).json({
        message: "The invoice has already been raised against this client. Ask an administrator to change it.",
      });
    }

    if (!isAdmin && remarks !== undefined && remarks !== (order.remarks ?? null)) {
      return res.status(403).json({ message: "Only an administrator can set order remarks." });
    }

    if (client_name) {
      try {
        const trimmed = client_name.trim();
        const existing = await prisma.client.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
        if (!existing && trimmed) await prisma.client.create({ data: { name: trimmed } });
      } catch (e) {
        console.error("Lookup upsert failed for client:", e);
      }
    }

    const { changes, log } = collectChanges();
    if (client_name !== undefined) log("Client Name", order.client_name, client_name);
    // undefined leaves the PO alone; an explicit null clears it.
    if (po_number !== undefined) log("PO Number", order.po_number || "", po_number || "");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const o = await tx.order.update({
        where: { id },
        data: {
          client_name: client_name !== undefined ? client_name : undefined,
          po_number: po_number !== undefined ? po_number : undefined,
          remarks: remarks !== undefined ? remarks : undefined,
          remarks_other_text: remarks_other_text !== undefined ? remarks_other_text : undefined,
        },
      });
      await recordHeaderChanges(tx, id, user, changes);
      return o;
    });

    if (changes.length > 0 && user.role === "CSM") {
      await sendOrderEditEmail(order.order_no, user.name, changes as FieldChange[]);
    }

    return res.status(200).json(serializeDecimals(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /api/orders/:orderId/stores/:storeId — one store's name, location and PO. */
export const updateStore = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    const storeId = parseInt(req.params.storeId as string, 10);
    const parseResult = updateStoreSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { store_name, location, po_number } = parseResult.data;
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { stores: { orderBy: { s_no: "asc" } } },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const store = order.stores.find((s) => s.id === storeId);
    if (!store) return res.status(404).json({ message: "Store not found on this order" });

    if (!isAdmin && !isHeaderEditable(order.status)) {
      return res.status(403).json({ message: "This order is settled. Ask an administrator to change it." });
    }

    // Once a store is on an invoice, its identity is what accounts billed against.
    const identityChange =
      (store_name !== undefined && store_name !== store.store_name) ||
      (location !== undefined && location !== store.location);
    if (!isAdmin && identityChange && store.invoice_id !== null) {
      return res.status(403).json({
        message: "This store has already been invoiced. Ask an administrator to change its name or location.",
      });
    }

    if (store_name !== undefined) {
      const clash = order.stores.some(
        (s) => s.id !== storeId && s.store_name.trim().toLowerCase() === store_name.trim().toLowerCase()
      );
      if (clash) return res.status(409).json({ message: "Another store in this order already has that name." });
    }

    const { changes, log } = collectChanges();
    const label = `S${String(store.s_no).padStart(2, "0")}`;
    if (store_name !== undefined) log(`${label} Store Name`, store.store_name, store_name);
    if (location !== undefined) log(`${label} Location`, store.location, location);
    if (po_number !== undefined) log(`${label} PO Number`, store.po_number || "", po_number || "");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const s = await tx.orderStore.update({
        where: { id: storeId },
        data: {
          store_name: store_name !== undefined ? store_name : undefined,
          location: location !== undefined ? location : undefined,
          po_number: po_number !== undefined ? po_number : undefined,
        },
      });
      await recordHeaderChanges(tx, orderId, user, changes);
      return s;
    });

    if (changes.length > 0 && user.role === "CSM") {
      await sendOrderEditEmail(order.order_no, user.name, changes as FieldChange[]);
    }

    return res.status(200).json(serializeDecimals(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/orders/:id/stores — add another store to an existing order. */
export const addStore = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id as string, 10);
    const parseResult = addStoreSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { store_name, location, po_number } = parseResult.data;
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { stores: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // A new store means new line items, so this follows the line-item rule, not the header one.
    if (!isAdmin && !isCsmEditable(order.status)) {
      return res.status(403).json({ message: "Stores can only be added before billing starts." });
    }
    if (order.stores.length >= 50) {
      return res.status(409).json({ message: "An order can hold at most 50 stores." });
    }
    if (order.stores.some((s) => s.store_name.trim().toLowerCase() === store_name.trim().toLowerCase())) {
      return res.status(409).json({ message: "This order already has a store with that name." });
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const maxSNo = order.stores.reduce((m, s) => Math.max(m, s.s_no), 0);
      const s = await tx.orderStore.create({
        data: { order_id: orderId, s_no: maxSNo + 1, store_name, location, po_number: po_number ?? null },
      });
      await recordHeaderChanges(tx, orderId, user, [
        { field: `S${String(s.s_no).padStart(2, "0")} Store (added)`, oldValue: "—", newValue: `${store_name}, ${location}` },
      ]);
      // A new, uninstalled store reopens an order that had finished installing.
      await recomputeOrderStatus(tx, orderId);
      return s;
    });

    return res.status(201).json(serializeDecimals(created));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/orders/:orderId/stores/:storeId — only while empty and unbilled. */
export const deleteStore = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    const storeId = parseInt(req.params.storeId as string, 10);
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { stores: { include: { _count: { select: { items: true } } }, orderBy: { s_no: "asc" } } },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const store = order.stores.find((s) => s.id === storeId);
    if (!store) return res.status(404).json({ message: "Store not found on this order" });

    if (!isAdmin && !isCsmEditable(order.status)) {
      return res.status(403).json({ message: "Stores can only be removed before billing starts." });
    }
    if (store.invoice_id !== null) {
      return res.status(409).json({ message: "This store has been invoiced and cannot be removed." });
    }
    if (store._count.items > 0) {
      return res.status(409).json({ message: "Remove this store's line items before removing the store." });
    }
    if (order.stores.length === 1) {
      return res.status(409).json({ message: "An order must keep at least one store." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      await tx.orderStore.delete({ where: { id: storeId } });
      await recordHeaderChanges(tx, orderId, user, [
        {
          field: `S${String(store.s_no).padStart(2, "0")} Store (removed)`,
          oldValue: `${store.store_name}, ${store.location}`,
          newValue: "—",
        },
      ]);
      // Removing the last uninstalled store can complete the order's installation.
      await recomputeOrderStatus(tx, orderId);
    });

    return res.status(200).json({ message: "Store removed" });
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

// ---------------------------------------------------------------------------------------
// Invoicing.
//
// An invoice covers a named set of stores, and its expected value is the billable total of
// *those* stores — not of the whole order. That is what makes several invoices against one
// order reconcilable rather than merely possible.
// ---------------------------------------------------------------------------------------

/**
 * Is this store ready to bill? Mirrors the old whole-order gate, scoped to one store:
 * anything that went through production must be produced and installation-confirmed;
 * a supply-only store (nothing ever assigned) bills directly without an installation date.
 */
const storeBillingBlocker = (store: any): string | null => {
  const assigned = store.items.filter((i: any) => i.assignments.length > 0);
  if (assigned.length === 0) return null;
  const pending = assigned.filter((i: any) => !i.production_completed);
  if (pending.length > 0) {
    return `Cannot bill ${store.store_name} — ${pending.length} assigned item(s) are still pending production completion.`;
  }
  if (store.installed_at == null) {
    return `Cannot bill ${store.store_name} — the order creator must confirm its installation first.`;
  }
  return null;
};

const invoiceCreatedNotices = async (
  order: any,
  invoice: { invoice_no: string; bill_amount: number },
  coveredTotal: number,
  isMatch: boolean,
  user: { name: string }
) => {
  if (!isMatch) {
    await sendPendingInvoiceEmail(order.order_no, order.client_name, coveredTotal, invoice.bill_amount);
  }
  if (!order.created_by) return;
  await notifyUser(
    order.created_by,
    `Invoice ${invoice.invoice_no} raised on ${order.order_no}`,
    isMatch
      ? `Covers ₹${invoice.bill_amount} in full — awaiting payment`
      : `Billed ₹${invoice.bill_amount} against ₹${coveredTotal} of covered work`,
    isMatch ? "success" : "warning",
    order.id
  );
  const creatorUser = await prisma.user.findUnique({ where: { id: order.created_by }, select: { email: true } });
  if (creatorUser?.email) {
    sendStatusTransitionEmail(
      creatorUser.email,
      order.order_no,
      order.client_name,
      "Billing Completed",
      `Invoice ${invoice.invoice_no} submitted. Bill amount: ₹${invoice.bill_amount}. ${
        isMatch ? "Matches the covered stores' total." : `Short of the ₹${coveredTotal} covered — invoice is pending review.`
      }`,
      user.name
    );
  }
};

/**
 * POST /api/orders/:id/invoices — raise an invoice over a set of this order's stores.
 */
export const createInvoice = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = invoiceSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { invoice_no, bill_amount, billing_date, store_ids } = parseResult.data;
    const user = req.user!;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { stores: { include: { items: { include: { assignments: true } } }, orderBy: { s_no: "asc" } } },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status === "Completed" || order.status === "PaymentReceived") {
      return res.status(400).json({ message: "Order is already closed" });
    }

    const byId = new Map(order.stores.map((s) => [s.id, s]));
    const wanted = [...new Set(store_ids)];
    const covered: NonNullable<ReturnType<typeof byId.get>>[] = [];
    for (const sid of wanted) {
      const store = byId.get(sid);
      if (!store) return res.status(400).json({ message: `Store ${sid} does not belong to this order.` });
      if (store.invoice_id !== null) {
        return res.status(409).json({ message: `${store.store_name} is already on another invoice.` });
      }
      const blocker = storeBillingBlocker(store);
      if (blocker) return res.status(400).json({ message: blocker });
      covered.push(store);
    }

    if (await prisma.invoice.findFirst({ where: { order_id: id, invoice_no } })) {
      return res.status(409).json({ message: `Invoice ${invoice_no} already exists on this order.` });
    }

    // The value this invoice is measured against: only the covered stores' items,
    // confirmed losses excluded.
    const coveredTotal = computeTotals(covered.flatMap((s) => s.items)).total_amount;
    if (Number(bill_amount) > coveredTotal) {
      return res.status(400).json({
        message: `Bill amount cannot exceed the ₹${coveredTotal.toFixed(2)} billable across the selected store(s).`,
      });
    }
    const isMatch = Number(bill_amount).toFixed(2) === coveredTotal.toFixed(2);

    const invoice = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const inv = await tx.invoice.create({
        data: {
          order_id: id,
          invoice_no,
          bill_amount,
          billing_date,
          billing_completed_at: isMatch ? new Date() : null,
        },
      });
      await tx.orderStore.updateMany({
        where: { id: { in: covered.map((s) => s.id) } },
        data: { invoice_id: inv.id },
      });
      await recomputeOrderStatus(tx, id);
      return inv;
    });

    await invoiceCreatedNotices(order, { invoice_no, bill_amount }, coveredTotal, isMatch, user);

    return res.status(201).json(serializeDecimals({ ...invoice, covered_total: coveredTotal }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * The order creator confirms the produced order has been installed. This is the
 * hand-off from production to billing: only after installation can Accounts invoice.
 * Applies to orders that went through production (have assigned items).
 */
/** Accounts hears about an order once, when the last of its stores goes in — not per store. */
const announceInstalled = async (order: { id: number; order_no: string; client_name: string }, user: { name: string }) => {
  await notifyRole(
    "ACCOUNTS",
    `Order ${order.order_no} installed — ready to bill`,
    `${user.name} confirmed installation. Produced and installed; ready for invoicing.`,
    "success",
    order.id
  );
  sendStatusTransitionEmail(
    adminEmail,
    order.order_no,
    order.client_name,
    "Installation Confirmed",
    `${user.name} confirmed installation. Order is now ready for billing.`,
    user.name
  );
};

/**
 * PUT /api/orders/:orderId/stores/:storeId/install
 *
 * Installation happens store by store, on different days. The order only reaches
 * `Installed` once every store is in, which is when accounts is told.
 */
export const markStoreInstalled = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    const storeId = parseInt(req.params.storeId as string, 10);
    const user = req.user!;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        stores: { include: { items: { include: { assignments: true } } }, orderBy: { s_no: "asc" } },
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const store = order.stores.find((s) => s.id === storeId);
    if (!store) return res.status(404).json({ message: "Store not found on this order" });

    // Only the creating employee (or an admin) may confirm installation.
    if (user.role === "CSM" && order.created_by !== user.id) {
      return res.status(403).json({ message: "Only the order's creator can confirm installation." });
    }

    if (order.status !== "Active") {
      return res.status(400).json({ message: "Only active orders can be marked installed." });
    }
    if (store.installed_at !== null) {
      return res.status(400).json({ message: "This store is already marked installed." });
    }

    // The production guard is scoped to this store's own items: store 1 can be installed
    // while store 2 is still on the press.
    const assignedItems = store.items.filter((i: any) => i.assignments.length > 0);
    if (assignedItems.length === 0) {
      return res.status(400).json({ message: "This store has no production work, so it goes straight to billing." });
    }
    const stillInProduction = assignedItems.filter((i: any) => !i.production_completed);
    if (stillInProduction.length > 0) {
      return res.status(400).json({
        message: `Cannot confirm installation — ${stillInProduction.length} item(s) are still in production.`,
      });
    }

    const { status } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      await tx.orderStore.update({
        where: { id: storeId },
        data: { installed_at: new Date(), installed_by: user.id },
      });
      return { status: await recomputeOrderStatus(tx, orderId) };
    });

    if (status === "Installed") await announceInstalled(order, user);

    const fresh = await prisma.order.findUnique({
      where: { id: orderId },
      include: { stores: { orderBy: { s_no: "asc" } } },
    });
    return res.status(200).json(serializeDecimals(fresh));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};


/**
 * Second accountant checkpoint: record payment against a billed order.
 * Full payment closes the order as PaymentReceived; a short payment leaves it
 * Pending so the shortfall stays visible.
 */
/**
 * PUT /api/orders/:orderId/invoices/:invoiceId/payment
 *
 * Payment is recorded per invoice. If a client settles three invoices in one transfer,
 * that is recorded as three payments — there is no separate payments ledger.
 */
export const recordInvoicePayment = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    const invoiceId = parseInt(req.params.invoiceId as string, 10);
    const parseResult = paymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { amount_received, payment_date } = parseResult.data;
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { invoices: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const invoice = order.invoices.find((i) => i.id === invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found on this order" });

    if (order.status === "Completed") {
      return res.status(400).json({ message: "Order is already closed" });
    }
    if (invoice.amount_received != null) {
      return res.status(400).json({ message: `Payment has already been recorded against invoice ${invoice.invoice_no}.` });
    }

    const billed = Number(invoice.bill_amount ?? 0);
    if (Number(amount_received) > billed) {
      return res.status(400).json({ message: "Amount received cannot exceed the billed amount." });
    }
    const isFull = Number(amount_received).toFixed(2) === billed.toFixed(2);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const inv = await tx.invoice.update({
        where: { id: invoiceId },
        data: { amount_received, payment_received_at: payment_date, payment_received_by: user.id },
      });
      await recomputeOrderStatus(tx, orderId);
      return inv;
    });

    if (order.created_by) {
      await notifyUser(
        order.created_by,
        `Payment ${isFull ? "received" : "partially received"} on invoice ${invoice.invoice_no} (${order.order_no})`,
        isFull
          ? `Full payment of ${amount_received} received against invoice ${invoice.invoice_no}.`
          : `Part payment of ${amount_received} received against ${billed} on invoice ${invoice.invoice_no}.`,
        isFull ? "success" : "warning",
        order.id
      );

      const creatorUser = await prisma.user.findUnique({ where: { id: order.created_by }, select: { email: true } });
      if (creatorUser?.email) {
        sendStatusTransitionEmail(
          creatorUser.email,
          order.order_no,
          order.client_name,
          "Payment Received",
          isFull
            ? `Full payment of ₹${amount_received} received against invoice ${invoice.invoice_no}.`
            : `Partial payment of ₹${amount_received} received against ₹${billed} on invoice ${invoice.invoice_no}.`,
          user.name
        );
      }
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
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
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
    
    if (user.role === "CSM") {
      where.created_by = user.id;
    }

    // "Active" = still in flight (incl. installed / billed-but-unpaid); "completed" =
    // closed either by payment received or by an admin closure.
    if (section === "active") where.status = { in: OPEN_STATUSES };
    if (section === "completed") where.status = { in: CLOSED_STATUSES };
    if (status) where.status = status;

    if (q) {
      where.OR = [
        { order_no: { contains: String(q), mode: "insensitive" } },
        { client_name: { contains: String(q), mode: "insensitive" } },
        { store_name: { contains: String(q), mode: "insensitive" } },
        { stores: { some: { store_name: { contains: String(q), mode: "insensitive" } } } },
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        // Each row names the store its own line item belongs to, so a multi-store order
        // exports one block per store rather than repeating the first store's name.
        items: {
          include: { assignments: true, orderStore: true },
          orderBy: [{ orderStore: { s_no: "asc" } }, { s_no: "asc" }],
        },
        stores: { orderBy: { s_no: "asc" } },
        invoices: { orderBy: { id: "asc" } },
        creator: true,
      },
      orderBy: { order_no: "asc" },
      take: 10000, // Cap to prevent memory exhaustion on large exports
    });

    const d = (x: Date | null | undefined) => (x ? x.toLocaleDateString("en-IN") : "");
    const dayspan = (a: Date | null | undefined, b: Date | null | undefined) =>
      a && b ? businessDaysBetween(a, b) : "";

    const rows: any[] = [];
    for (const order of orders) {
      // Billable total excludes confirmed losses; used for the Pending Amount column.
      const total = computeTotals(order.items).total_amount;
      const producedAt = lastProducedAt(order);
      const roll = rollupOrder(order);
      const stage = currentStage(order);
      for (const item of order.items) {
        const lossStatus = item.remarks == null ? "" : (item.remarks_confirmed ? "Loss (confirmed)" : "Loss (proposed)");
        const row: any = {
          "S.No": item.s_no,
          "Date": order.date.toLocaleDateString("en-IN"),
          "Client Name": order.client_name,
          "Store Name": item.orderStore?.store_name ?? "",
          "Location": item.orderStore?.location ?? "",
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
          row["Invoice No"] = roll.invoice_no || "";
          row["Bill Amount"] = roll.bill_amount !== null ? roll.bill_amount : "";
          row["Amount Received"] = roll.amount_received !== null ? roll.amount_received : "";
          // Outstanding = billable total less whatever has actually been received.
          row["Pending Amount"] = isClosed(order.status) ? "" : total - Number(roll.amount_received ?? 0);
          row["Billing Date"] = d(roll.billing_date);
          row["Billing Completed On"] = d(roll.billing_completed_at);
          row["Payment Received On"] = d(roll.payment_received_at);
        }
        if (user.role === "ADMIN") {
          row["Created By"] = order.creator_name;
          // TAT (Phase 6): milestone dates + stage-to-stage durations, in days.
          row["Produced On"] = d(producedAt);
          row["Installed On"] = d(roll.installed_at);
          row["Days: Create→Produce"] = dayspan(order.created_at, producedAt);
          row["Days: Produce→Install"] = dayspan(producedAt, roll.installed_at);
          row["Days: Install→Bill"] = dayspan(roll.installed_at, roll.billing_completed_at);
          row["Days: Bill→Pay"] = dayspan(roll.billing_completed_at, roll.payment_received_at);
          row["Total TAT (days)"] = dayspan(order.created_at, roll.payment_received_at);
          row["Current Stage"] = stage ? stage.stage : "Closed";
          row["Days in Stage"] = stage ? stage.days_in_stage : "";
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
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
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

import { flagItemSchema, itemLossRemarkSchema, assignItemSchema, completeItemSchema, editBillingSchema, editPaymentSchema, followUpSchema } from "../utils/validators";

/** PATCH /api/orders/:orderId/invoices/:invoiceId/billing */
export const editInvoiceBilling = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    const invoiceId = parseInt(req.params.invoiceId as string, 10);
    const parseResult = editBillingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { invoice_no, bill_amount, billing_date, store_ids } = parseResult.data;
    const user = req.user!;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        invoices: true,
        stores: { include: { items: { include: { assignments: true } } }, orderBy: { s_no: "asc" } },
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const invoice = order.invoices.find((i) => i.id === invoiceId);
    if (!invoice) {
      return res.status(400).json({ message: "No billing record to edit — submit an invoice first." });
    }

    // Re-scoping which stores an invoice covers changes what it is measured against, so
    // it is only allowed while nothing has been paid against it.
    let covered = order.stores.filter((s) => s.invoice_id === invoiceId);
    if (store_ids !== undefined) {
      if (invoice.amount_received != null) {
        return res.status(409).json({ message: "This invoice has been paid; its store coverage can no longer be changed." });
      }
      const byId = new Map(order.stores.map((s) => [s.id, s]));
      const next: typeof covered = [];
      for (const sid of [...new Set(store_ids)]) {
        const store = byId.get(sid);
        if (!store) return res.status(400).json({ message: `Store ${sid} does not belong to this order.` });
        if (store.invoice_id !== null && store.invoice_id !== invoiceId) {
          return res.status(409).json({ message: `${store.store_name} is already on another invoice.` });
        }
        const blocker = storeBillingBlocker(store);
        if (blocker) return res.status(400).json({ message: blocker });
        next.push(store);
      }
      covered = next;
    }

    const coveredTotal = computeTotals(covered.flatMap((s) => s.items)).total_amount;
    const effectiveAmount = bill_amount !== undefined ? Number(bill_amount) : Number(invoice.bill_amount ?? 0);
    if (effectiveAmount > coveredTotal) {
      return res.status(400).json({
        message: `Bill amount cannot exceed the ₹${coveredTotal.toFixed(2)} billable across the selected store(s).`,
      });
    }

    const changes: FieldChange[] = [];
    if (invoice_no !== undefined && invoice_no !== invoice.invoice_no) {
      changes.push({ field: "Invoice No", oldValue: invoice.invoice_no || "—", newValue: invoice_no });
    }
    if (bill_amount !== undefined && Number(bill_amount).toFixed(2) !== Number(invoice.bill_amount ?? 0).toFixed(2)) {
      changes.push({ field: "Bill Amount", oldValue: `₹${Number(invoice.bill_amount ?? 0).toFixed(2)}`, newValue: `₹${Number(bill_amount).toFixed(2)}` });
    }
    if (billing_date !== undefined) {
      const oldDate = invoice.billing_date ? invoice.billing_date.toLocaleDateString("en-IN") : "—";
      const newDate = billing_date.toLocaleDateString("en-IN");
      if (oldDate !== newDate) {
        changes.push({ field: "Billing Date", oldValue: oldDate, newValue: newDate });
      }
    }
    if (store_ids !== undefined) {
      const oldNames = order.stores.filter((s) => s.invoice_id === invoiceId).map((s) => s.store_name).join(", ") || "—";
      const newNames = covered.map((s) => s.store_name).join(", ") || "—";
      if (oldNames !== newNames) {
        changes.push({ field: `Invoice ${invoice.invoice_no} Stores`, oldValue: oldNames, newValue: newNames });
      }
    }

    if (changes.length === 0) {
      return res.status(400).json({ message: "No changes detected." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;

      await tx.orderChangeLog.createMany({
        data: changes.map((c) => ({
          order_id: orderId,
          changed_by: user.id,
          field_changed: c.field,
          old_value: c.oldValue,
          new_value: c.newValue,
        })),
      });

      if (store_ids !== undefined) {
        const keep = covered.map((s) => s.id);
        await tx.orderStore.updateMany({
          where: { order_id: orderId, invoice_id: invoiceId, id: { notIn: keep } },
          data: { invoice_id: null },
        });
        await tx.orderStore.updateMany({ where: { id: { in: keep } }, data: { invoice_id: invoiceId } });
      }

      const inv = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          ...(invoice_no !== undefined ? { invoice_no } : {}),
          ...(bill_amount !== undefined ? { bill_amount } : {}),
          ...(billing_date !== undefined ? { billing_date } : {}),
          // Whether the invoice fully covers its stores can change with either edit.
          billing_completed_at: effectiveAmount.toFixed(2) === coveredTotal.toFixed(2) ? (invoice.billing_completed_at ?? new Date()) : null,
        },
      });
      await recomputeOrderStatus(tx, orderId);
      return inv;
    });

    sendBillingEditEmail(order.order_no, user.name, user.role, changes);

    return res.status(200).json(serializeDecimals(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /api/orders/:orderId/invoices/:invoiceId/payment-edit */
export const editInvoicePayment = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    const invoiceId = parseInt(req.params.invoiceId as string, 10);
    const parseResult = editPaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { amount_received, payment_date } = parseResult.data;
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { invoices: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const invoice = order.invoices.find((i) => i.id === invoiceId);
    if (!invoice || !invoice.payment_received_at) {
      return res.status(400).json({ message: "No payment record to edit — record a payment first." });
    }

    if (amount_received !== undefined && Number(amount_received) > Number(invoice.bill_amount ?? 0)) {
      return res.status(400).json({ message: "Amount received cannot exceed the billed amount." });
    }

    const changes: FieldChange[] = [];
    if (amount_received !== undefined && Number(amount_received).toFixed(2) !== Number(invoice.amount_received ?? 0).toFixed(2)) {
      changes.push({ field: "Amount Received", oldValue: `₹${Number(invoice.amount_received ?? 0).toFixed(2)}`, newValue: `₹${Number(amount_received).toFixed(2)}` });
    }
    if (payment_date !== undefined) {
      const oldDate = invoice.payment_received_at ? invoice.payment_received_at.toLocaleDateString("en-IN") : "—";
      const newDate = payment_date.toLocaleDateString("en-IN");
      if (oldDate !== newDate) {
        changes.push({ field: "Payment Date", oldValue: oldDate, newValue: newDate });
      }
    }

    if (changes.length === 0) {
      return res.status(400).json({ message: "No changes detected." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;

      await tx.orderChangeLog.createMany({
        data: changes.map((c) => ({
          order_id: orderId,
          changed_by: user.id,
          field_changed: c.field,
          old_value: c.oldValue,
          new_value: c.newValue,
        })),
      });

      const inv = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          ...(amount_received !== undefined ? { amount_received } : {}),
          ...(payment_date !== undefined ? { payment_received_at: payment_date } : {}),
        },
      });
      await recomputeOrderStatus(tx, orderId);
      return inv;
    });

    sendBillingEditEmail(order.order_no, user.name, user.role, changes);

    return res.status(200).json(serializeDecimals(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};



export const getFollowUps = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id as string, 10);
    const followUps = await prisma.paymentFollowUp.findMany({
      where: { order_id: orderId },
      include: { author: { select: { id: true, name: true, role: true } } },
      orderBy: { created_at: "desc" },
    });
    return res.status(200).json(followUps);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createFollowUp = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id as string, 10);
    const parseResult = followUpSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { note } = parseResult.data;
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { invoices: true } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!rollupOrder(order).billing_completed_at) {
      return res.status(400).json({ message: "Follow-ups can only be added after billing is completed." });
    }

    const followUp = await prisma.paymentFollowUp.create({
      data: { order_id: orderId, note, created_by: user.id },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    return res.status(201).json(followUp);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const itemLabelOf = (i: any) =>
  `#${i.s_no} — ${i.media} (${Number(i.width_inches)}x${Number(i.height_inches)} in, qty ${Number(i.qty)})`;

/**
 * Recompute an item's rollup flag: it is production-complete only when every
 * assignment on it is complete (and at least one assignment exists).
 */
async function syncItemCompletion(tx: any, itemId: number) {
  const assignments = await tx.orderItemAssignment.findMany({ where: { order_item_id: itemId } });
  const allDone = assignments.length > 0 && assignments.every((a: any) => a.completed);
  const latest = assignments
    .map((a: any) => a.completed_at)
    .filter(Boolean)
    .sort((x: Date, y: Date) => y.getTime() - x.getTime())[0] ?? null;

  await tx.orderItem.update({
    where: { id: itemId },
    data: {
      production_completed: allDone,
      production_completed_at: allDone ? latest ?? new Date() : null,
    },
  });
  return allDone;
}

/**
 * Operator sets the full list of production users assigned to a line item.
 * A line item can be split across several teams; passing [] clears all assignments.
 * Existing assignees keep their completion state so re-assigning a co-worker
 * doesn't wipe work already reported.
 */
export const assignOrderItem = async (req: Request, res: Response) => {
  try {
    const parseResult = assignItemSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    const assigned_to = Array.from(new Set(parseResult.data.assigned_to));
    const orderId = parseInt(req.params.orderId as string, 10);
    const itemId = parseInt(req.params.itemId as string, 10);
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.status === "Completed" || order.status === "PaymentReceived") {
      return res.status(400).json({ message: "Closed orders cannot be reassigned." });
    }

    const item = await prisma.orderItem.findUnique({ where: { id: itemId }, include: { assignments: true } });
    if (!item || item.order_id !== orderId) return res.status(404).json({ message: "Line item not found" });

    if (assigned_to.length > 0) {
      const staff = await prisma.user.findMany({ where: { id: { in: assigned_to }, role: "PRODUCTION", is_active: true } });
      if (staff.length !== assigned_to.length) {
        return res.status(400).json({ message: "Items can only be assigned to active production users." });
      }
    }

    const existingIds = item.assignments.map((a) => a.user_id);
    const toAdd = assigned_to.filter((id) => !existingIds.includes(id));
    const toRemove = existingIds.filter((id) => !assigned_to.includes(id));

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      if (toRemove.length > 0) {
        await tx.orderItemAssignment.deleteMany({ where: { order_item_id: itemId, user_id: { in: toRemove } } });
      }
      for (const id of toAdd) {
        await tx.orderItemAssignment.create({
          data: { order_item_id: itemId, user_id: id, assigned_by: user.id },
        });
      }
      await syncItemCompletion(tx, itemId);
    });

    for (const id of toAdd) {
      await notifyUser(
        id,
        `New item assigned on ${order.order_no}`,
        `${user.name} assigned you item ${itemLabelOf(item)}.`,
        "info",
        order.id
      );
    }

    const fresh = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
    });
    return res.status(200).json(serializeDecimals(fresh));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * A production user marks *their own* assignment on a line item complete (or reopens it).
 * The item only becomes production-complete once every assigned team has done so.
 * A flagged item is blocked until an admin resolves the flag.
 */
export const completeOrderItem = async (req: Request, res: Response) => {
  try {
    const parseResult = completeItemSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    const { production_completed } = parseResult.data;
    const orderId = parseInt(req.params.orderId as string, 10);
    const itemId = parseInt(req.params.itemId as string, 10);
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const item = await prisma.orderItem.findUnique({ where: { id: itemId }, include: { assignments: true } });
    if (!item || item.order_id !== orderId) return res.status(404).json({ message: "Line item not found" });
    if (item.assignments.length === 0) {
      return res.status(400).json({ message: "This item has not been assigned yet." });
    }
    if (production_completed && item.is_flagged) {
      return res.status(400).json({ message: "This item is flagged as mistaken — an admin must resolve the flag before it can be completed." });
    }

    // Production users may only report on their own assignment.
    // Operators/admins acting on the item update every outstanding assignment.
    const targets = user.role === "PRODUCTION"
      ? item.assignments.filter((a) => a.user_id === user.id)
      : item.assignments;

    if (targets.length === 0) {
      return res.status(403).json({ message: "You can only update items assigned to you." });
    }

    const wasComplete = item.production_completed;
    const nowComplete = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      await tx.orderItemAssignment.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: production_completed
          ? { completed: true, completed_at: new Date() }
          : { completed: false, completed_at: null },
      });
      return syncItemCompletion(tx, itemId);
    });

    // Tell the employee who raised the order as soon as a line item is fully produced.
    if (nowComplete && !wasComplete && order.created_by) {
      await notifyUser(
        order.created_by,
        `Item produced on ${order.order_no}`,
        `Production finished item ${itemLabelOf(item)}.`,
        "success",
        order.id
      );
    }

    // When every assigned item on the order is done, prompt the employee to confirm
    // installation. Billing only opens up after that confirmation.
    if (nowComplete) {
      const remaining = await prisma.orderItem.count({
        where: { order_id: orderId, assignments: { some: {} }, production_completed: false },
      });
      if (remaining === 0 && order.created_by) {
        await notifyUser(
          order.created_by,
          `Order ${order.order_no} is production complete`,
          `All items are produced. Confirm installation to send it for billing.`,
          "success",
          order.id
        );

        const creatorUser = await prisma.user.findUnique({ where: { id: order.created_by }, select: { email: true } });
        if (creatorUser?.email) {
          sendStatusTransitionEmail(
            creatorUser.email,
            order.order_no,
            order.client_name,
            "Production Complete",
            "All assigned items have been produced. Please confirm installation to proceed with billing.",
            user.name
          );
        }
      }
    }

    const fresh = await prisma.orderItem.findUnique({
      where: { id: itemId },
      include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
    });
    return res.status(200).json(serializeDecimals(fresh));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const flagOrderItem = async (req: Request, res: Response) => {
  try {
    const parseResult = flagItemSchema.safeParse(req.body);
    if (!parseResult.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    const { is_flagged, flag_reason } = parseResult.data;
    const orderId = parseInt(req.params.orderId as string, 10);
    const itemId = parseInt(req.params.itemId as string, 10);
    const user = req.user!;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (user.role === "CSM" && order.created_by !== user.id) {
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
    if (!parseResult.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    const { remarks, remarks_other_text } = parseResult.data;
    const itemId = parseInt(req.params.itemId as string, 10);
    const user = req.user!;

    // An admin setting a remark confirms it as a real loss (excluded from the billable total).
    // Clearing the remark rejects it — the line becomes chargeable again.
    const item = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      const updated = await tx.orderItem.update({
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
      // Confirming or rejecting a loss changes the billable total the invoices are
      // reconciled against.
      await recomputeOrderStatus(tx, updated.order_id);
      return updated;
    });
    return res.status(200).json(serializeDecimals(item));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* ─── Email Export ──────────────────────────────────────────────── */

/**
 * Generate the same XLSX as exportOrders but email it as an attachment instead of
 * downloading. Saves the recipient address for autocomplete.
 */
export const emailExport = async (req: Request, res: Response) => {
  try {
    const { to, subject, message, section, status, q } = req.body as {
      to: string; subject?: string; message?: string;
      section?: string; status?: string; q?: string;
    };
    const user = req.user!;

    if (!to || !to.includes("@")) {
      return res.status(400).json({ message: "A valid recipient email is required." });
    }

    // Build the XLSX exactly like exportOrders
    const where: any = {};
    if (user.role === "CSM") where.created_by = user.id;
    if (section === "active") where.status = { in: OPEN_STATUSES };
    if (section === "completed") where.status = { in: CLOSED_STATUSES };
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { order_no: { contains: String(q), mode: "insensitive" } },
        { client_name: { contains: String(q), mode: "insensitive" } },
        { store_name: { contains: String(q), mode: "insensitive" } },
        { stores: { some: { store_name: { contains: String(q), mode: "insensitive" } } } },
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: {
          include: { assignments: true, orderStore: true },
          orderBy: [{ orderStore: { s_no: "asc" } }, { s_no: "asc" }],
        },
        stores: { orderBy: { s_no: "asc" } },
        invoices: { orderBy: { id: "asc" } },
        creator: true,
      },
      orderBy: { order_no: "asc" },
      take: 10000, // Cap to prevent memory exhaustion on large exports
    });

    const d = (x: Date | null | undefined) => (x ? x.toLocaleDateString("en-IN") : "");
    const dayspan = (a: Date | null | undefined, b: Date | null | undefined) =>
      a && b ? businessDaysBetween(a, b) : "";

    const rows: any[] = [];
    for (const order of orders) {
      const total = computeTotals(order.items).total_amount;
      const producedAt = lastProducedAt(order);
      const roll = rollupOrder(order);
      const stage = currentStage(order);
      for (const item of order.items) {
        const lossStatus = item.remarks == null ? "" : (item.remarks_confirmed ? "Loss (confirmed)" : "Loss (proposed)");
        const row: any = {
          "S.No": item.s_no,
          "Date": order.date.toLocaleDateString("en-IN"),
          "Client Name": order.client_name,
          "Store Name": item.orderStore?.store_name ?? "",
          "Location": item.orderStore?.location ?? "",
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
          row["Invoice No"] = roll.invoice_no || "";
          row["Bill Amount"] = roll.bill_amount !== null ? roll.bill_amount : "";
          row["Amount Received"] = roll.amount_received !== null ? roll.amount_received : "";
          row["Pending Amount"] = isClosed(order.status) ? "" : total - Number(roll.amount_received ?? 0);
          row["Billing Date"] = d(roll.billing_date);
        }
        if (user.role === "ADMIN") {
          row["Created By"] = order.creator_name;
          row["Current Stage"] = stage ? stage.stage : "Closed";
          row["Days in Stage"] = stage ? stage.days_in_stage : "";
        }
        rows.push(row);
      }
    }

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Orders");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `orders_${new Date().toISOString().split("T")[0]}.xlsx`;
    const emailSubject = subject || `Orders Export — ${new Date().toLocaleDateString("en-IN")}`;
    const emailMessage = message || `Please find the attached orders export with ${orders.length} order(s) and ${rows.length} line item(s).`;

    await sendExcelEmail(to, emailSubject, emailMessage, buffer, filename, user.name);

    // Save recipient for autocomplete (upsert to update last-used timestamp)
    await prisma.emailRecipient.upsert({
      where: { email_used_by: { email: to.toLowerCase(), used_by: user.id } },
      create: { email: to.toLowerCase(), used_by: user.id },
      update: { used_at: new Date() },
    });

    return res.status(200).json({
      message: `Export emailed to ${to} successfully.`,
      orders_count: orders.length,
      items_count: rows.length,
    });
  } catch (err) {
    console.error("Email export error:", err);
    return res.status(500).json({ message: "Failed to send email. Please try again." });
  }
};

/** Autocomplete recently-used email recipients for the current user. */
export const getRecentRecipients = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const q = String(req.query.q || "").toLowerCase();
    const recipients = await prisma.emailRecipient.findMany({
      where: {
        used_by: user.id,
        ...(q ? { email: { contains: q, mode: "insensitive" as const } } : {}),
      },
      orderBy: { used_at: "desc" },
      take: 10,
    });
    return res.status(200).json(recipients.map((r) => r.email));
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Download a line-item-only Excel template for CSM import into the order form. */
export const lineItemTemplate = async (_req: Request, res: Response) => {
  try {
    const header = ["Media", "Size (W) in", "Size (H) in", "Qty", "Rate"];
    const example = [
      { "Media": "Vinyl", "Size (W) in": 48, "Size (H) in": 36, "Qty": 2, "Rate": 40 },
      { "Media": "Flex", "Size (W) in": 96, "Size (H) in": 48, "Qty": 1, "Rate": 25 },
    ];
    const ws = xlsx.utils.json_to_sheet(example, { header });
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Line Items");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", "attachment; filename=line_item_template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
