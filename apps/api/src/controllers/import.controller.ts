import { Request, Response } from "express";
import * as xlsx from "xlsx";
import { prisma } from "../utils/prisma";
import { ensureLookupValue } from "../utils/lookups";

// Canonical import column headers, with a few tolerant aliases.
const H: Record<string, string[]> = {
  orderNo: ["Order No", "Order Number", "OrderNo"],
  date: ["Date", "Order Date"],
  client: ["Client Name", "Client"],
  jobPo: ["Job PO Number", "Job PO"],
  store: ["Store Name", "Store"],
  location: ["Location"],
  storePo: ["Store PO Number", "Store PO"],
  // Pre-multi-store sheets carried a single "PO Number", which was the job-level PO.
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

const TEMPLATE_HEADER = [
  "Order No", "Date", "Client Name", "Job PO Number",
  "Store Name", "Location", "Store PO Number",
  "Employee", "Media", "Size (W) in", "Size (H) in", "Qty", "Rate",
];

const INSTRUCTIONS: string[][] = [
  ["Bulk order import — how this sheet is read"],
  [],
  ["One row is one line item. Rows are grouped, not read independently."],
  [],
  ["1. Rows that share an Order No become ONE order, under one order number."],
  ["   Twenty stores handed over together belong on twenty groups of rows sharing a single Order No."],
  [],
  ["2. Within an order, rows that share a Store Name become ONE store."],
  ["   Each store keeps its own line items, its own Location and its own Store PO Number."],
  [],
  ["3. These must not disagree between rows of the same order:"],
  ["      Date, Client Name, Job PO Number, Employee"],
  ["   These must not disagree between rows of the same store:"],
  ["      Location, Store PO Number"],
  ["   A blank cell means \"same as the rest of the group\" and is fine. Two different"],
  ["   non-blank values are rejected, naming both rows — the file is not partially imported."],
  [],
  ["4. Job PO Number covers the whole order. Store PO Number covers one store."],
  ["   Leave either blank if it has not arrived yet; both can be added later in the app."],
  [],
  ["5. Order No must be supplied and must not already exist in the system."],
  ["   Date drives the turnaround clock, so use the date the job was actually taken."],
  ["   Employee is the username of an active employee, e.g. bablugoud."],
  [],
  ["6. Limits: 500 rows per file, 50 stores per order. Nothing is imported unless"],
  ["   every row passes — errors come back numbered by sheet row."],
  [],
  ["Older sheets with a single \"PO Number\" column still import; that column is read as the Job PO."],
  [],
  ["Fill in the Import sheet. The example rows there show one order across two stores — delete them before uploading."],
];

/** Downloadable .xlsx template: an Instructions sheet and the Import sheet to fill in. */
export const importTemplate = async (_req: Request, res: Response) => {
  try {
    const row = (
      orderNo: string, date: string, client: string, jobPo: string,
      store: string, location: string, storePo: string,
      media: string, w: number, h: number, q: number, r: number
    ) => ({
      "Order No": orderNo, "Date": date, "Client Name": client, "Job PO Number": jobPo,
      "Store Name": store, "Location": location, "Store PO Number": storePo,
      "Employee": "bablugoud", "Media": media, "Size (W) in": w, "Size (H) in": h, "Qty": q, "Rate": r,
    });

    // One order number, two stores, several items each — the shape this import exists for.
    const example = [
      row("ORD250001", "2025-06-15", "Acme Corp", "JOB-PO-88", "MG Road", "Bengaluru", "PO-11", "Vinyl", 48, 36, 2, 40),
      row("ORD250001", "2025-06-15", "Acme Corp", "JOB-PO-88", "MG Road", "Bengaluru", "PO-11", "Flex", 96, 48, 1, 25),
      row("ORD250001", "2025-06-15", "Acme Corp", "JOB-PO-88", "Indiranagar", "Bengaluru", "PO-12", "Vinyl", 36, 24, 3, 40),
      row("ORD250001", "2025-06-15", "Acme Corp", "JOB-PO-88", "Indiranagar", "Bengaluru", "PO-12", "Flex", 72, 48, 1, 25),
    ];

    const wb = xlsx.utils.book_new();

    const instructions = xlsx.utils.aoa_to_sheet(INSTRUCTIONS);
    instructions["!cols"] = [{ wch: 100 }];
    xlsx.utils.book_append_sheet(wb, instructions, "Instructions");

    const importSheet = xlsx.utils.json_to_sheet(example, { header: TEMPLATE_HEADER });
    importSheet["!cols"] = TEMPLATE_HEADER.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    xlsx.utils.book_append_sheet(wb, importSheet, "Import");

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
interface PStore {
  s_no: number; store_name: string;
  location: string; locationRow: number;
  po: string | null; poRow: number;
  items: PItem[]; firstRow: number;
}
interface POrder {
  order_no: string;
  date: Date | null; dateRow: number;
  client: string; clientRow: number;
  jobPo: string | null; jobPoRow: number;
  employeeUsername: string; employeeRow: number;
  stores: Map<string, PStore>;
  firstRow: number;
}

/**
 * Bulk import orders from an uploaded .xlsx (super-admin only).
 *
 * Rows sharing an Order No form one order; within that, rows sharing a Store Name form
 * one store. The sheet's Date drives created_at + Order.date (TAT clock). Validation is
 * all-or-nothing: any error imports nothing and returns a row-indexed list. Imported
 * orders enter the pipeline as Active.
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
      // The template ships an Instructions sheet first; the data lives on "Import".
      const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "import") ?? wb.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
    } catch {
      return res.status(400).json({ message: "Could not read the file. Make sure it is a valid .xlsx." });
    }
    if (rows.length === 0) return res.status(400).json({ message: "The sheet has no data rows." });
    if (rows.length > 500) return res.status(400).json({ message: `Too many rows (${rows.length}). Maximum 500 rows per import.` });

    const employees = await prisma.user.findMany({ where: { role: "CSM", is_active: true } });
    const empByUsername = new Map(employees.map((u) => [u.username.toLowerCase(), u]));

    const errors: { row: number; message: string }[] = [];
    const now = Date.now();
    const orders = new Map<string, POrder>();

    /**
     * A field that must agree across a group. A blank means "same as the rest of the
     * group" — only two different *filled-in* values are a conflict, which is the
     * silent-corruption case this exists to catch.
     */
    const reconcile = (
      current: string | null, currentRow: number,
      incoming: string, rowNum: number,
      label: string, scope: string
    ): { value: string | null; row: number } => {
      if (!incoming) return { value: current, row: currentRow };
      if (current == null || current === "") return { value: incoming, row: rowNum };
      if (current !== incoming) {
        errors.push({
          row: rowNum,
          message: `${label} '${incoming}' conflicts with '${current}' used on row ${currentRow} ${scope}.`,
        });
      }
      return { value: current, row: currentRow };
    };

    // Pass 1: parse and validate each row, grouping by Order No then by Store Name.
    rows.forEach((raw: any, idx: number) => {
      const rowNum = idx + 2; // header is row 1
      const orderNo = String(cell(raw, H.orderNo)).trim();
      const media = String(cell(raw, H.media)).trim();
      const num = (keys: string[]) => Number(String(cell(raw, keys)).replace(/,/g, "").trim());
      const w = num(H.width), h = num(H.height), q = num(H.qty), r = num(H.rate);

      if (!orderNo) { errors.push({ row: rowNum, message: "Missing Order No." }); return; }
      if (!media) errors.push({ row: rowNum, message: "Missing Media." });
      for (const [label, v] of [["Size (W)", w], ["Size (H)", h], ["Qty", q], ["Rate", r]] as [string, number][]) {
        if (!Number.isFinite(v) || v <= 0) errors.push({ row: rowNum, message: `${label} must be a positive number.` });
      }

      const rawDate = cell(raw, H.date);
      let date: Date | null = null;
      if (rawDate instanceof Date) date = rawDate;
      else if (rawDate !== "") { const d = new Date(String(rawDate)); if (!isNaN(d.getTime())) date = d; }
      if (rawDate !== "" && !date) errors.push({ row: rowNum, message: "Invalid Date." });
      if (date && date.getTime() > now + 86400000) errors.push({ row: rowNum, message: "Date cannot be in the future." });

      const client = String(cell(raw, H.client)).trim();
      const storeName = String(cell(raw, H.store)).trim();
      const location = String(cell(raw, H.location)).trim();
      const storePo = String(cell(raw, H.storePo)).trim();
      const jobPo = String(cell(raw, [...H.jobPo, ...H.po])).trim();
      const employeeUsername = String(cell(raw, H.employee)).trim();

      let order = orders.get(orderNo);
      if (!order) {
        order = {
          order_no: orderNo,
          date: null, dateRow: rowNum,
          client: "", clientRow: rowNum,
          jobPo: null, jobPoRow: rowNum,
          employeeUsername: "", employeeRow: rowNum,
          stores: new Map(),
          firstRow: rowNum,
        };
        orders.set(orderNo, order);
      }

      // Order-level fields must agree across every row of the order.
      const scope = `for order ${orderNo}`;
      const dateStr = date ? date.toISOString().slice(0, 10) : "";
      const dateAgreed = reconcile(
        order.date ? order.date.toISOString().slice(0, 10) : null, order.dateRow,
        dateStr, rowNum, "Date", scope
      );
      if (dateAgreed.value && !order.date) order.date = new Date(`${dateAgreed.value}T00:00:00.000Z`);
      order.dateRow = dateAgreed.row;

      const c = reconcile(order.client || null, order.clientRow, client, rowNum, "Client Name", scope);
      order.client = c.value ?? ""; order.clientRow = c.row;

      const j = reconcile(order.jobPo, order.jobPoRow, jobPo, rowNum, "Job PO Number", scope);
      order.jobPo = j.value; order.jobPoRow = j.row;

      const e = reconcile(order.employeeUsername || null, order.employeeRow, employeeUsername, rowNum, "Employee", scope);
      order.employeeUsername = e.value ?? ""; order.employeeRow = e.row;

      if (!storeName) {
        errors.push({ row: rowNum, message: "Missing Store Name." });
        return;
      }

      let store = order.stores.get(storeName);
      if (!store) {
        store = {
          s_no: order.stores.size + 1, // first-appearance order
          store_name: storeName,
          location: "", locationRow: rowNum,
          po: null, poRow: rowNum,
          items: [], firstRow: rowNum,
        };
        order.stores.set(storeName, store);
      }

      // Store-level fields must agree across every row of that store.
      const storeScope = `for store '${storeName}' in order ${orderNo}`;
      const l = reconcile(store.location || null, store.locationRow, location, rowNum, "Location", storeScope);
      store.location = l.value ?? ""; store.locationRow = l.row;

      const sp = reconcile(store.po, store.poRow, storePo, rowNum, "Store PO Number", storeScope);
      store.po = sp.value; store.poRow = sp.row;

      if (media && [w, h, q, r].every((v) => Number.isFinite(v) && v > 0)) {
        // s_no restarts at 1 inside each store.
        store.items.push({ s_no: store.items.length + 1, media, w, h, q, r });
      }
    });

    // Pass 2: group-level completeness, duplicates and collisions.
    const clashes = await prisma.order.findMany({
      where: { order_no: { in: Array.from(orders.keys()) } },
      select: { order_no: true },
    });
    const clashSet = new Set(clashes.map((c) => c.order_no));

    for (const o of orders.values()) {
      if (clashSet.has(o.order_no)) errors.push({ row: o.firstRow, message: `Order No ${o.order_no} already exists.` });
      if (!o.date) errors.push({ row: o.firstRow, message: `Order ${o.order_no} has no Date.` });
      if (!o.client) errors.push({ row: o.firstRow, message: `Order ${o.order_no} has no Client Name.` });
      if (!o.employeeUsername) errors.push({ row: o.firstRow, message: `Order ${o.order_no} has no Employee.` });
      else if (!empByUsername.has(o.employeeUsername.toLowerCase())) {
        errors.push({ row: o.employeeRow, message: `Employee "${o.employeeUsername}" is not an active employee.` });
      }
      if (o.stores.size === 0) errors.push({ row: o.firstRow, message: `Order ${o.order_no} has no stores.` });
      if (o.stores.size > 50) errors.push({ row: o.firstRow, message: `Order ${o.order_no} has ${o.stores.size} stores. Maximum 50 per order.` });

      // Two spellings of one store name would silently become two stores.
      const seen = new Map<string, PStore>();
      for (const s of o.stores.values()) {
        const key = s.store_name.toLowerCase();
        const prior = seen.get(key);
        if (prior) {
          errors.push({
            row: s.firstRow,
            message: `Store Name '${s.store_name}' conflicts with '${prior.store_name}' used on row ${prior.firstRow} for order ${o.order_no}.`,
          });
        } else seen.set(key, s);

        if (!s.location) errors.push({ row: s.firstRow, message: `Store '${s.store_name}' in order ${o.order_no} has no Location.` });
        if (s.items.length === 0) errors.push({ row: s.firstRow, message: `Store '${s.store_name}' in order ${o.order_no} has no valid line items.` });
      }
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
    let storeCount = 0;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id.toString()}, true)`;
      for (const o of orders.values()) {
        const emp = empByUsername.get(o.employeeUsername.toLowerCase())!;
        await ensureLookupValue(tx, "client", o.client);
        const storeList = Array.from(o.stores.values()).sort((a, b) => a.s_no - b.s_no);
        for (const s of storeList) {
          for (const it of s.items) await ensureLookupValue(tx, "media", it.media);
        }

        const created = await tx.order.create({
          data: {
            order_no: o.order_no,
            client_name: o.client,
            po_number: o.jobPo,
            date: o.date!, created_at: o.date!, // sheet date drives the TAT clock
            created_by: emp.id, creator_name: emp.name, status: "Active",
            stores: {
              create: storeList.map((s) => ({
                s_no: s.s_no, store_name: s.store_name, location: s.location, po_number: s.po,
              })),
            },
          },
          include: { stores: { orderBy: { s_no: "asc" } } },
        });
        storeCount += created.stores.length;

        const itemRows = created.stores.flatMap((storeRow, index) =>
          storeList[index]!.items.map((it) => {
            const total_sft = Number((((it.w * it.h) / 144) * it.q).toFixed(2));
            const amount = Number((total_sft * it.r).toFixed(2));
            itemCount++;
            return {
              order_id: created.id, order_store_id: storeRow.id,
              s_no: it.s_no, media: it.media,
              width_inches: it.w, height_inches: it.h, qty: it.q,
              total_sft, rate: it.r, amount,
            };
          })
        );
        await tx.orderItem.createMany({ data: itemRows });
      }
    }, { timeout: 120000 });

    return res.status(201).json({
      message: "Import successful.",
      orders_imported: orders.size,
      stores_imported: storeCount,
      line_items_imported: itemCount,
    });
  } catch (err: any) {
    console.error("Bulk import error:", err);
    return res.status(500).json({ message: "Internal server error during import." });
  }
};
