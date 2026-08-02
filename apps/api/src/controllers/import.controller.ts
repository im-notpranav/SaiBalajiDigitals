import { Request, Response } from "express";
import * as xlsx from "xlsx";
import { prisma } from "../utils/prisma";
import { ensureLookupValue } from "../utils/lookups";

// Canonical import column headers, with a few tolerant aliases.
const H: Record<string, string[]> = {
  orderNo: ["Order No", "Order Number", "OrderNo"],
  date: ["Date", "Order Date"],
  client: ["Client Name", "Client"],
  store: ["Store Name", "Store"],
  location: ["Location"],
  po: ["PO Number", "PO"],
  employee: ["Employee", "Employee Username", "Created By"],
  media: ["Media"],
  width: ["Size (W) in", "Width", "Width (in)", "W"],
  height: ["Size (H) in", "Height", "Height (in)", "H"],
  qty: ["Qty", "Quantity"],
  rate: ["Rate", "Rate (per Sq.Ft.)"],
};
const cell = (row: any, keys: string[]) => {
  for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== "") return row[k];
  return "";
};

/** Downloadable .xlsx template for the bulk import (header row + a worked example). */
export const importTemplate = async (_req: Request, res: Response) => {
  try {
    const header = ["Order No", "Date", "Client Name", "Store Name", "Location", "PO Number", "Employee", "Media", "Size (W) in", "Size (H) in", "Qty", "Rate"];
    const example = [
      { "Order No": "ORD250001", "Date": "2025-06-15", "Client Name": "Acme Corp", "Store Name": "MG Road", "Location": "Bengaluru", "PO Number": "PO-11", "Employee": "bablugoud", "Media": "Vinyl", "Size (W) in": 48, "Size (H) in": 36, "Qty": 2, "Rate": 40 },
      { "Order No": "ORD250001", "Date": "2025-06-15", "Client Name": "Acme Corp", "Store Name": "MG Road", "Location": "Bengaluru", "PO Number": "PO-11", "Employee": "bablugoud", "Media": "Flex", "Size (W) in": 96, "Size (H) in": 48, "Qty": 1, "Rate": 25 },
    ];
    const ws = xlsx.utils.json_to_sheet(example, { header });
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Import");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", "attachment; filename=order_import_template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

interface PItem { s_no: number; media: string; w: number; h: number; q: number; r: number; }
interface POrder {
  order_no: string; date: Date; client: string; store: string; location: string;
  po: string | null; employeeUsername: string; items: PItem[]; firstRow: number;
}

/**
 * Bulk import orders from an uploaded .xlsx (super-admin only). Rows sharing an
 * Order No form one order; the sheet's Date drives created_at + Order.date (TAT
 * clock). Validation is all-or-nothing: any error imports nothing and returns a
 * row-indexed list. Imported orders enter the pipeline as Active.
 */
export const bulkImportOrders = async (req: Request, res: Response) => {
  try {
    const buf = req.body;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ message: "No file received. Upload the .xlsx file as the request body." });
    }

    let rows: any[];
    try {
      const wb = xlsx.read(buf, { type: "buffer", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    } catch {
      return res.status(400).json({ message: "Could not read the file. Make sure it is a valid .xlsx." });
    }
    if (rows.length === 0) return res.status(400).json({ message: "The sheet has no data rows." });

    const employees = await prisma.user.findMany({ where: { role: "EMPLOYEE", is_active: true } });
    const empByUsername = new Map(employees.map((u) => [u.username.toLowerCase(), u]));

    const errors: { row: number; message: string }[] = [];
    const now = Date.now();
    const orders = new Map<string, POrder>();

    // Pass 1: parse & validate each row, grouping by Order No.
    rows.forEach((row: any, idx: number) => {
      const rowNum = idx + 2; // header is row 1
      const orderNo = String(cell(row, H.orderNo)).trim();
      const media = String(cell(row, H.media)).trim();
      const num = (keys: string[]) => Number(String(cell(row, keys)).replace(/,/g, "").trim());
      const w = num(H.width), h = num(H.height), q = num(H.qty), r = num(H.rate);

      if (!orderNo) { errors.push({ row: rowNum, message: "Missing Order No." }); return; }
      if (!media) errors.push({ row: rowNum, message: "Missing Media." });
      for (const [label, v] of [["Size (W)", w], ["Size (H)", h], ["Qty", q], ["Rate", r]] as [string, number][]) {
        if (!Number.isFinite(v) || v <= 0) errors.push({ row: rowNum, message: `${label} must be a positive number.` });
      }

      let order = orders.get(orderNo);
      if (!order) {
        const rawDate = cell(row, H.date);
        let date: Date | null = null;
        if (rawDate instanceof Date) date = rawDate;
        else if (rawDate !== "") { const d = new Date(String(rawDate)); if (!isNaN(d.getTime())) date = d; }

        const client = String(cell(row, H.client)).trim();
        const store = String(cell(row, H.store)).trim();
        const location = String(cell(row, H.location)).trim();
        const employeeUsername = String(cell(row, H.employee)).trim();

        if (!date) errors.push({ row: rowNum, message: "Missing or invalid Date." });
        else if (date.getTime() > now + 86400000) errors.push({ row: rowNum, message: "Date cannot be in the future." });
        if (!client) errors.push({ row: rowNum, message: "Missing Client Name." });
        if (!store) errors.push({ row: rowNum, message: "Missing Store Name." });
        if (!location) errors.push({ row: rowNum, message: "Missing Location." });
        if (!employeeUsername) errors.push({ row: rowNum, message: "Missing Employee." });
        else if (!empByUsername.has(employeeUsername.toLowerCase()))
          errors.push({ row: rowNum, message: `Employee "${employeeUsername}" is not an active employee.` });

        order = {
          order_no: orderNo, date: date ?? new Date(), client, store, location,
          po: String(cell(row, H.po)).trim() || null,
          employeeUsername, items: [], firstRow: rowNum,
        };
        orders.set(orderNo, order);
      }

      if (media && [w, h, q, r].every((v) => Number.isFinite(v) && v > 0)) {
        order.items.push({ s_no: order.items.length + 1, media, w, h, q, r });
      }
    });

    // Collision check: Order No already in the system, and empty orders.
    const clashes = await prisma.order.findMany({ where: { order_no: { in: Array.from(orders.keys()) } }, select: { order_no: true } });
    const clashSet = new Set(clashes.map((c) => c.order_no));
    for (const o of orders.values()) {
      if (clashSet.has(o.order_no)) errors.push({ row: o.firstRow, message: `Order No ${o.order_no} already exists.` });
      if (o.items.length === 0) errors.push({ row: o.firstRow, message: `Order ${o.order_no} has no valid line items.` });
    }

    if (errors.length > 0) {
      errors.sort((a, b) => a.row - b.row);
      return res.status(422).json({
        message: `Import rejected — ${errors.length} problem(s) found. Nothing was imported.`,
        errors: errors.slice(0, 200),
        orders_in_file: orders.size,
      });
    }

    // Import everything in one transaction (all-or-nothing).
    const user = req.user!;
    let itemCount = 0;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      for (const o of orders.values()) {
        const emp = empByUsername.get(o.employeeUsername.toLowerCase())!;
        await ensureLookupValue(tx, "client", o.client);
        for (const it of o.items) await ensureLookupValue(tx, "media", it.media);
        const items = o.items.map((it) => {
          const total_sft = Number((((it.w * it.h) / 144) * it.q).toFixed(2));
          const amount = Number((total_sft * it.r).toFixed(2));
          itemCount++;
          return { s_no: it.s_no, media: it.media, width_inches: it.w, height_inches: it.h, qty: it.q, total_sft, rate: it.r, amount };
        });
        await tx.order.create({
          data: {
            order_no: o.order_no, client_name: o.client, store_name: o.store, location: o.location,
            po_number: o.po, date: o.date, created_at: o.date, // sheet date drives the TAT clock
            created_by: emp.id, creator_name: emp.name, status: "Active",
            items: { create: items },
          },
        });
      }
    }, { timeout: 120000 });

    return res.status(201).json({ message: "Import successful.", orders_imported: orders.size, line_items_imported: itemCount });
  } catch (err: any) {
    console.error("Bulk import error:", err);
    return res.status(500).json({ message: "Internal server error during import." });
  }
};
