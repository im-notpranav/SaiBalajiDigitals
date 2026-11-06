import * as xlsx from "xlsx";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * The company's order spreadsheet, used for uploads, the downloadable template and exports.
 *
 * On upload, S.No, Order No, Total SFT and Amount are ignored: the number comes from the
 * sequence, and SFT and Amount are worked out here. One order per client.
 */
export const ORDER_TEMPLATE_HEADER = [
  "S.No", "Date", "Client Name", "Location", "Store Name", "Order No", "Media",
  "Size (W) Inches", "Size (H) Inches", "Qty", "Total SFT", "Rate", "Amount",
];

const MAX_ROWS = 500;
const MAX_STORES = 50;
const BLANK_TEMPLATE_ROWS = 200;

/** Lower-case headings each column may go by. The company's file writes " Amount " with spaces. */
const COLUMNS: Record<string, string[]> = {
  date: ["date", "order date"],
  client: ["client name", "client"],
  location: ["location"],
  store: ["store name", "store"],
  media: ["media"],
  width: ["size (w) inches", "size (w) in", "width"],
  height: ["size (h) inches", "size (h) in", "height"],
  qty: ["qty", "quantity"],
  rate: ["rate", "rate (per sq.ft.)"],
};

/** Mirrors createOrder: SFT to two decimals, and Amount from that rounded SFT. */
export const sftOf = (w: number, h: number, q: number) => Number((((w * h) / 144) * q).toFixed(2));
export const amountOf = (sft: number, rate: number) => Number((sft * rate).toFixed(2));

export interface TemplateItem {
  media: string;
  width_inches: number;
  height_inches: number;
  qty: number;
  rate: number;
  total_sft: number;
  amount: number;
}
export interface TemplateStore {
  store_name: string;
  location: string;
  items: TemplateItem[];
}
export interface TemplateOrder {
  client_name: string;
  /** The first date on the client's rows, as YYYY-MM-DD. */
  date: string;
  /** Later rows of the client carry a different date, which the order does not keep. */
  has_other_dates: boolean;
  first_row: number;
  stores: TemplateStore[];
}
export interface TemplateError {
  row: number;
  message: string;
}

const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * A date cell as YYYY-MM-DD. Real date cells are read as the serial Excel stores, which has no
 * time zone: the file's dates are midnight in India, and turning them into a JS Date first would
 * move them a day back on a UTC server. Typed dates are read day first.
 */
function dayOf(raw: unknown): string | null {
  if (typeof raw === "number") {
    const parts = xlsx.SSF.parse_date_code(raw);
    return parts ? iso(parts.y, parts.m, parts.d) : null;
  }
  const text = String(raw).trim();
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(text);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return iso(year, Number(dmy[2]), Number(dmy[1]));
  }
  return null;
}

const number = (raw: unknown) => Number(String(raw).replace(/,/g, "").trim());
const todayPlusOne = () => new Date(Date.now() + 5.5 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

/** Reads the first sheet, or says plainly what is wrong with the file. Every row is checked. */
export function parseOrderTemplate(file: Buffer): { orders: TemplateOrder[]; errors: TemplateError[]; fileError?: string } {
  let rows: unknown[][];
  let firstRowNumber = 1;
  try {
    const wb = xlsx.read(file, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    if (sheet["!ref"]) firstRowNumber = xlsx.utils.decode_range(sheet["!ref"]).s.r + 1;
    rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  } catch {
    return { orders: [], errors: [], fileError: "Could not read the file. Make sure it is a valid Excel file." };
  }

  // The company's sheet starts with its headings, but a title row above them is harmless.
  const headerIndex = Math.max(0, rows.findIndex((r) => r.some((h) => String(h).trim().toLowerCase() === "client name")));
  const headings = (rows[headerIndex] ?? []).map((h) => String(h).trim().toLowerCase());
  const at: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, names] of Object.entries(COLUMNS)) {
    const i = headings.findIndex((h) => names.includes(h));
    if (i === -1) missing.push(names[0]!);
    at[key] = i;
  }
  if (missing.length) {
    return { orders: [], errors: [], fileError: `This is not the order template: it has no ${missing.join(", ")} column. Download the template and use that.` };
  }

  const errors: TemplateError[] = [];
  const clients = new Map<string, TemplateOrder>();
  const storesOf = new Map<TemplateOrder, Map<string, TemplateStore>>();
  /** The last Location per client and store name: a blank one means the same place as before. */
  const lastLocation = new Map<string, string>();
  const lastDate = new Map<string, string>();
  const maxDate = todayPlusOne();

  const data = rows.slice(headerIndex + 1);
  // Formula rows the sheet has prepared but nobody has filled in are not data.
  const filled = (r: unknown[]) =>
    ["date", "client", "location", "store", "media"].some((k) => String(r[at[k]!] ?? "").trim() !== "");
  const dataCount = data.filter(filled).length;
  if (dataCount === 0) return { orders: [], errors: [], fileError: "The sheet has no order rows." };
  if (dataCount > MAX_ROWS) return { orders: [], errors: [], fileError: `This file has ${dataCount} rows. The most it can take is ${MAX_ROWS}, so split it.` };

  data.forEach((r, idx) => {
    if (!filled(r)) return;
    const rowNo = firstRowNumber + headerIndex + idx + 1;
    const fail = (message: string) => errors.push({ row: rowNo, message });
    const text = (k: string) => String(r[at[k]!] ?? "").trim();

    const client = text("client");
    if (!client) return fail("Missing Client Name.");
    const clientKey = client.toLowerCase();

    const rawDate = r[at.date!];
    const typedDate = String(rawDate ?? "").trim() === "" ? null : dayOf(rawDate);
    if (String(rawDate ?? "").trim() !== "" && !typedDate) return fail("The Date cannot be read. Use a date like 01/04/2026.");
    if (typedDate && typedDate > maxDate) return fail("The Date cannot be in the future.");
    const date = typedDate ?? lastDate.get(clientKey);
    if (!date) return fail(`Missing Date for ${client}.`);
    lastDate.set(clientKey, date);

    const storeName = text("store");
    if (!storeName) return fail("Missing Store Name.");
    const nameKey = `${clientKey}\u0000${storeName.toLowerCase()}`;
    const location = text("location") || lastLocation.get(nameKey) || "";
    if (!location) return fail(`Missing Location for ${storeName}.`);
    lastLocation.set(nameKey, location);

    const media = text("media");
    const [w, h, q, rate] = [number(r[at.width!]), number(r[at.height!]), number(r[at.qty!]), number(r[at.rate!])] as [number, number, number, number];
    if (!media) return fail("Missing Media.");
    if (!(w > 0)) return fail("Size (W) must be a number above 0.");
    if (!(h > 0)) return fail("Size (H) must be a number above 0.");
    if (!(q > 0) || !Number.isInteger(q)) return fail("Qty must be a whole number above 0.");
    if (!(rate > 0)) return fail("Rate must be a number above 0.");

    let order = clients.get(clientKey);
    if (!order) {
      order = { client_name: client, date, has_other_dates: false, first_row: rowNo, stores: [] };
      clients.set(clientKey, order);
      storesOf.set(order, new Map());
    }
    if (date !== order.date) order.has_other_dates = true;

    const stores = storesOf.get(order)!;
    const storeKey = `${storeName.toLowerCase()}\u0000${location.toLowerCase()}`;
    let store = stores.get(storeKey);
    if (!store) {
      store = { store_name: storeName, location, items: [] };
      stores.set(storeKey, store);
      order.stores.push(store);
    }
    const total_sft = sftOf(w, h, q);
    store.items.push({ media, width_inches: w, height_inches: h, qty: q, rate, total_sft, amount: amountOf(total_sft, rate) });
  });

  const orders = [...clients.values()];
  for (const o of orders) {
    if (o.stores.length > MAX_STORES) {
      errors.push({ row: o.first_row, message: `${o.client_name} has ${o.stores.length} stores. An order can hold at most ${MAX_STORES}.` });
    }
  }
  return { orders, errors: errors.sort((a, b) => a.row - b.row) };
}

/** The blank template: the headings, with S.No, Total SFT and Amount working as the sheet is typed in. */
export function buildOrderTemplate(): Buffer {
  const sheet = xlsx.utils.aoa_to_sheet([ORDER_TEMPLATE_HEADER]);
  for (let r = 2; r <= BLANK_TEMPLATE_ROWS + 1; r++) {
    sheet[`A${r}`] = { t: "str", v: "", f: `IF(B${r}="","",ROW()-1)` };
    sheet[`K${r}`] = { t: "str", v: "", f: `IF(B${r}="","",H${r}*I${r}*J${r}/144)` };
    sheet[`M${r}`] = { t: "str", v: "", f: `IF(B${r}="","",K${r}*L${r})` };
  }
  sheet["!ref"] = `A1:M${BLANK_TEMPLATE_ROWS + 1}`;
  sheet["!cols"] = ORDER_TEMPLATE_HEADER.map((h) => ({ wch: Math.max(10, h.length + 3) }));

  const guide = xlsx.utils.aoa_to_sheet([
    ["How this sheet is read"],
    [],
    ["One row is one item. Fill in Date, Client Name, Location, Store Name, Media, Size (W), Size (H), Qty and Rate."],
    ["Leave S.No, Order No, Total SFT and Amount. The system ignores them, gives the order number, and works out SFT and Amount."],
    ["Total SFT = Width x Height x Qty / 144. Amount = Total SFT x Rate."],
    ["Each Client Name becomes one order. The first date on that client's rows is the order date."],
    ["Rows with the same Store Name and Location are one store."],
    [`Limits: ${MAX_ROWS} rows per file, ${MAX_STORES} stores per order.`],
    ["You will see every order on a review screen before anything is saved."],
  ]);
  guide["!cols"] = [{ wch: 110 }];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, sheet, "Orders");
  xlsx.utils.book_append_sheet(wb, guide, "How to fill");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** An export of the matching orders, in the template's columns and nothing else. */
export async function buildOrdersExport(where: Prisma.OrderWhereInput) {
  const orders = await prisma.order.findMany({
    where,
    select: {
      order_no: true,
      client_name: true,
      date: true,
      items: {
        select: {
          media: true,
          width_inches: true,
          height_inches: true,
          qty: true,
          total_sft: true,
          rate: true,
          amount: true,
          orderStore: { select: { store_name: true, location: true } },
        },
        orderBy: [{ orderStore: { s_no: "asc" } }, { s_no: "asc" }],
      },
    },
    orderBy: { order_no: "asc" },
    take: 10000, // Cap to prevent memory exhaustion on large exports
  });

  let serial = 0;
  const rows = orders.flatMap((order) =>
    order.items.map((item) => ({
      "S.No": ++serial,
      "Date": order.date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      "Client Name": order.client_name,
      "Location": item.orderStore?.location ?? "",
      "Store Name": item.orderStore?.store_name ?? "",
      "Order No": order.order_no,
      "Media": item.media,
      "Size (W) Inches": Number(item.width_inches),
      "Size (H) Inches": Number(item.height_inches),
      "Qty": Number(item.qty),
      "Total SFT": Number(item.total_sft),
      "Rate": Number(item.rate),
      "Amount": Number(item.amount),
    })),
  );

  const ws = xlsx.utils.json_to_sheet(rows, { header: ORDER_TEMPLATE_HEADER });
  ws["!cols"] = ORDER_TEMPLATE_HEADER.map((h) => ({ wch: Math.max(10, h.length + 3) }));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Orders");
  const buffer: Buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
  return { buffer, orderCount: orders.length, itemCount: rows.length };
}
