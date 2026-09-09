/**
 * Parses the New Order line-item spreadsheet into stores.
 *
 * One row is one line item; rows sharing a Store Name become one store. The header
 * aliases match `apps/api/src/controllers/import.controller.ts` wherever the columns
 * overlap, so staff learn one file format rather than two.
 *
 * Pure functions — no React, no form types. It takes what `xlsx.utils.sheet_to_json`
 * produces and hands back stores plus human-readable errors.
 */

export interface ParsedItem {
  media: string;
  /** Text, not a number: the form's Line fields are strings so partial decimals survive. */
  width_inches: string;
  height_inches: string;
  qty: number;
  rate: string;
}

export interface ParsedStore {
  store_name: string;
  location: string;
  po_number: string;
  items: ParsedItem[];
}

export interface SheetParseResult {
  stores: ParsedStore[];
  errors: string[];
  /** False when the sheet has no Store Name column — an old five-column file. */
  hadStoreColumn: boolean;
}

const MAX_ROWS = 500;
const MAX_STORES = 50;

/** Tolerant column headers. Kept in step with import.controller.ts where they overlap. */
const H: Record<string, string[]> = {
  store: ["Store Name", "Store"],
  location: ["Location"],
  storePo: ["Store PO Number", "Store PO"],
  media: ["Media", "media", "MEDIA"],
  width: ["Size (W) in", "Width", "Width (in)", "W", "width_inches", "width"],
  height: ["Size (H) in", "Height", "Height (in)", "H", "height_inches", "height"],
  qty: ["Qty", "Quantity", "qty", "QTY"],
  rate: ["Rate", "Rate (per Sq.Ft.)", "rate", "RATE"],
};

const cell = (row: any, keys: string[]) => {
  for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== "") return row[k];
  return "";
};

const num = (row: any, keys: string[]) => Number(String(cell(row, keys)).replace(/,/g, ""));

/** A store being assembled, tracking which row first supplied each shared field. */
interface StoreDraft {
  store_name: string;
  location: string;
  locationRow: number;
  po_number: string;
  poRow: number;
  items: ParsedItem[];
  firstRow: number;
}

export function parseOrderSheet(rows: any[]): SheetParseResult {
  const errors: string[] = [];

  const hadStoreColumn = rows.some((r) => String(cell(r, H.store)).trim() !== "");

  let data = rows;
  if (rows.length > MAX_ROWS) {
    errors.push(`This file has ${rows.length} rows. Only the first ${MAX_ROWS} are read — split it into smaller files.`);
    data = rows.slice(0, MAX_ROWS);
  }

  // Insertion-ordered, so stores come out in the order they appear in the sheet.
  const drafts = new Map<string, StoreDraft>();

  /**
   * A field that must agree across a store. A blank means "same as the rest of the
   * store" — only two different filled-in values are a conflict.
   */
  const reconcile = (
    current: string, currentRow: number,
    incoming: string, rowNum: number,
    label: string, storeName: string
  ): { value: string; row: number } => {
    if (!incoming) return { value: current, row: currentRow };
    if (!current) return { value: incoming, row: rowNum };
    if (current !== incoming) {
      errors.push(`Row ${rowNum}: ${label} '${incoming}' conflicts with '${current}' used on row ${currentRow} for store '${storeName}'.`);
    }
    return { value: current, row: currentRow };
  };

  data.forEach((row, idx) => {
    const rowNum = idx + 2; // the header occupies row 1
    const storeName = String(cell(row, H.store)).trim();
    const media = String(cell(row, H.media)).trim();
    const location = String(cell(row, H.location)).trim();
    const storePo = String(cell(row, H.storePo)).trim();
    const w = num(row, H.width);
    const h = num(row, H.height);
    const q = num(row, H.qty);
    const r = num(row, H.rate);

    // A sheet that names stores must name one on every row: a blank is a mistake,
    // never "same as the row above".
    if (hadStoreColumn && !storeName) {
      errors.push(`Row ${rowNum}: Missing Store Name`);
      return;
    }

    // Group case-insensitively but keep the first spelling seen. OrderForm.submit
    // rejects duplicate names case-insensitively, so grouping any other way would
    // parse cleanly and then fail on save.
    const key = storeName.toLowerCase();
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        store_name: storeName,
        location: "", locationRow: rowNum,
        po_number: "", poRow: rowNum,
        items: [],
        firstRow: rowNum,
      };
      drafts.set(key, draft);
    }

    const loc = reconcile(draft.location, draft.locationRow, location, rowNum, "Location", draft.store_name);
    draft.location = loc.value;
    draft.locationRow = loc.row;

    const po = reconcile(draft.po_number, draft.poRow, storePo, rowNum, "Store PO Number", draft.store_name);
    draft.po_number = po.value;
    draft.poRow = po.row;

    // A row that fails validation is skipped; its store still exists if other rows
    // in the group are good.
    if (!media) { errors.push(`Row ${rowNum}: Missing Media`); return; }
    if (!Number.isFinite(w) || w <= 0) { errors.push(`Row ${rowNum}: Invalid Width`); return; }
    if (!Number.isFinite(h) || h <= 0) { errors.push(`Row ${rowNum}: Invalid Height`); return; }
    if (!Number.isFinite(q) || q <= 0) { errors.push(`Row ${rowNum}: Invalid Qty`); return; }
    if (!Number.isInteger(q)) { errors.push(`Row ${rowNum}: Qty must be a whole number`); return; }
    if (!Number.isFinite(r) || r <= 0) { errors.push(`Row ${rowNum}: Invalid Rate`); return; }

    draft.items.push({
      media,
      width_inches: String(w),
      height_inches: String(h),
      qty: q,
      rate: String(r),
    });
  });

  const drafted = [...drafts.values()];

  if (drafted.length > MAX_STORES) {
    errors.push(`Row ${drafted[MAX_STORES]!.firstRow}: this file has ${drafted.length} stores. An order can hold at most ${MAX_STORES}.`);
  }

  if (hadStoreColumn) {
    for (const d of drafted) {
      if (!d.location) {
        errors.push(`Row ${d.firstRow}: store '${d.store_name}' has no Location.`);
      }
    }
  }

  return {
    stores: drafted.map((d) => ({
      store_name: d.store_name,
      location: d.location,
      po_number: d.po_number,
      items: d.items,
    })),
    errors,
    hadStoreColumn,
  };
}
