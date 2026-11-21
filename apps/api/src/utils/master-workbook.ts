import * as xlsx from "xlsx";
import {
  CODE_PATTERN,
  LOCALITY_SHEET_LABELS,
  cleanCode,
  cleanName,
  lowerKey,
  nameKey,
  parseActive,
  parseLocality,
  type MasterKind,
} from "./master-names";

/**
 * The Master Library workbook: one sheet each for Clients, Media and Locations. The template,
 * the export and the import share these columns, so export -> edit -> import goes round.
 *
 * The import never deletes. New names are added; names already in the list (ignoring case) get
 * their code, locality, district or Active updated when the cell is filled. Blank cells leave
 * things as they are, blank rows are skipped, other sheets are ignored.
 */

export type Locality = "LOCAL" | "NON_LOCAL";

export const SHEET_NAMES: Record<MasterKind, string> = { CLIENT: "Clients", MEDIA: "Media", LOCATION: "Locations" };

export const SHEET_HEADERS: Record<MasterKind, string[]> = {
  CLIENT: ["Name", "Code", "Short Name", "Contact Person", "Contact Number", "Email", "CSM Name", "Active"],
  MEDIA: ["Name", "Default Machine", "Active"],
  LOCATION: ["Name", "Hyderabad / Non-local", "District", "State", "Active"],
};

/** Other names the company's own sheets go by (OMS Clients Data, OMS Line Items, ...). */
const SHEET_ALIASES: Record<MasterKind, string[]> = {
  CLIENT: ["clients", "omsclientsdata", "clientsdata", "client"],
  MEDIA: ["media", "omslineitems", "lineitems", "lineitem"],
  LOCATION: ["locations", "omslocations", "location"],
};

/**
 * Columns beyond name, code, locality, district and active, per sheet. Each is optional; a
 * blank cell leaves the value as it is.
 */
export const EXTRAS: Record<MasterKind, { field: string; label: string; aliases: string[]; max: number }[]> = {
  CLIENT: [
    { field: "short_name", label: "Short name", aliases: ["short name"], max: 100 },
    { field: "contact_person", label: "Contact person", aliases: ["contact person", "contact name"], max: 100 },
    { field: "contact_number", label: "Contact number", aliases: ["contact number", "contact no", "contact no.", "mobile", "mobile number", "phone"], max: 30 },
    { field: "email", label: "Email", aliases: ["mail id", "email", "email id", "e-mail", "mail"], max: 200 },
    { field: "csm_name", label: "CSM", aliases: ["csm name", "csm"], max: 100 },
  ],
  MEDIA: [{ field: "machine", label: "Default machine", aliases: ["default machine", "machine"], max: 60 }],
  LOCATION: [{ field: "state", label: "State", aliases: ["state", "state name"], max: 60 }],
};

/** Lower-case headings each column may go by. */
const COLUMNS: Record<string, string[]> = {
  name: [
    "name",
    "client name",
    "client",
    "client official registered name",
    "media name",
    "media",
    "sbd oms line items",
    "line item",
    "line items",
    "line item name",
    "location name",
    "location",
    "area name",
    "area",
  ],
  code: ["code", "client code", "sbd code", "sbd client code", "client id"],
  locality: ["hyderabad / non-local", "hyderabad/non-local", "hyderabad / non local", "hyderabad /non local", "hyderabad/ non local", "hyderabad or non-local", "locality", "local / non-local", "local/non-local"],
  district: ["district", "district / notes"],
  active: ["active", "status"],
};

const MAX_ROWS = 5000;
const MAX_NAME: Record<MasterKind, number> = { CLIENT: 200, MEDIA: 200, LOCATION: 100 };
/** Example rows in the template start with this and are skipped, so an untouched template adds nothing. */
const EXAMPLE_PREFIX = "example:";

export interface SheetRow {
  /** The row number as Excel shows it. */
  row: number;
  name: string;
  /** Undefined when the cell is blank: leave the value as it is. */
  code?: string;
  locality?: Locality;
  district?: string;
  active?: boolean;
  /** EXTRAS columns that were filled, by field. */
  extra?: Record<string, string>;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ParsedSheet {
  /** The sheet was in the file. */
  found: boolean;
  rows: SheetRow[];
  errors: RowError[];
  /** Something wrong with the whole sheet, such as no Name column. */
  problem?: string;
}

const text = (v: unknown) => String(v ?? "").trim();
const heading = (v: unknown) => text(v).toLowerCase().replace(/\s+/g, " ");

/**
 * Reads one sheet given as rows of cells (as sheet_to_json with header: 1 gives them).
 * `firstRowNumber` is the Excel row of the first array entry.
 */
export function parseMasterSheet(kind: MasterKind, rows: unknown[][], firstRowNumber = 1): ParsedSheet {
  const out: ParsedSheet = { found: true, rows: [], errors: [] };
  // The headings may sit under a title row; look a few rows down for them.
  const headerIndex = rows.slice(0, 10).findIndex((r) => r.some((c) => COLUMNS.name!.includes(heading(c))));
  if (headerIndex === -1) {
    out.problem = `The ${SHEET_NAMES[kind]} sheet has no Name column.`;
    return out;
  }
  const headings = rows[headerIndex]!.map((h) => heading(h));
  const col = (key: string) => headings.findIndex((h) => COLUMNS[key]!.includes(h));
  const at = {
    name: col("name"),
    code: kind === "CLIENT" ? col("code") : -1,
    locality: kind === "LOCATION" ? col("locality") : -1,
    district: kind === "LOCATION" ? col("district") : -1,
    active: col("active"),
  };
  const extraAt = EXTRAS[kind].map((x) => ({ ...x, at: headings.findIndex((h) => x.aliases.includes(h)) })).filter((x) => x.at !== -1);

  const data = rows.slice(headerIndex + 1);
  const filled = (r: unknown[]) => r.some((c) => text(c) !== "");
  const count = data.filter(filled).length;
  if (count > MAX_ROWS) {
    out.problem = `The ${SHEET_NAMES[kind]} sheet has ${count} rows. The most it can take is ${MAX_ROWS}, so split it.`;
    return out;
  }

  /** First row of each name in this sheet, by its key, to catch the same name typed twice. */
  const seen = new Map<string, { row: number; name: string }>();
  const codes = new Map<string, number>();

  data.forEach((r, idx) => {
    if (!filled(r)) return;
    const rowNo = firstRowNumber + headerIndex + idx + 1;
    const fail = (message: string) => out.errors.push({ row: rowNo, message });
    const cell = (i: number) => (i === -1 ? "" : text(r[i]));

    const name = cleanName(cell(at.name));
    if (!name) return fail("Missing Name.");
    if (name.toLowerCase().startsWith(EXAMPLE_PREFIX)) return;
    if (name.length > MAX_NAME[kind]) return fail(`Name is longer than ${MAX_NAME[kind]} letters.`);

    const key = nameKey(name);
    const earlier = seen.get(key);
    if (earlier) {
      return fail(
        lowerKey(earlier.name) === lowerKey(name)
          ? `Same name as row ${earlier.row}.`
          : `Looks the same as "${earlier.name}" on row ${earlier.row}.`,
      );
    }

    const entry: SheetRow = { row: rowNo, name };

    if (at.code !== -1 && cell(at.code)) {
      const code = cleanCode(cell(at.code));
      if (!CODE_PATTERN.test(code)) return fail("Code can only have letters, numbers, - and _ (up to 30).");
      const other = codes.get(code);
      if (other) return fail(`Code ${code} is also on row ${other}.`);
      codes.set(code, rowNo);
      entry.code = code;
    }
    if (at.locality !== -1 && cell(at.locality)) {
      const locality = parseLocality(cell(at.locality));
      if (!locality) return fail("Write Hyderabad or Non-local.");
      entry.locality = locality;
    }
    if (at.district !== -1 && cell(at.district)) {
      const district = cleanName(cell(at.district));
      if (district.length > 100) return fail("District is longer than 100 letters.");
      entry.district = district;
    }
    if (at.active !== -1 && cell(at.active)) {
      const active = parseActive(cell(at.active));
      if (active == null) return fail("Active must be Yes or No.");
      entry.active = active;
    }

    for (const x of extraAt) {
      const v = cell(x.at).replace(/\s+/g, " ");
      if (!v) continue;
      if (v.length > x.max) return fail(`${x.label} is longer than ${x.max} letters.`);
      (entry.extra ??= {})[x.field] = v;
    }

    seen.set(key, { row: rowNo, name });
    out.rows.push(entry);
  });
  return out;
}

/**
 * Trims a sheet's declared range to its first 20 columns. Our sheets use at most five, and a
 * range claiming thousands of columns would make sheet_to_json build huge empty rows.
 */
function capColumns(sheet: xlsx.WorkSheet) {
  if (!sheet["!ref"]) return;
  const range = xlsx.utils.decode_range(sheet["!ref"]);
  if (range.e.c - range.s.c > 19) {
    range.e.c = range.s.c + 19;
    sheet["!ref"] = xlsx.utils.encode_range(range);
  }
}

/** Reads all three sheets of an uploaded file, matching sheet names without regard to case or spaces. */
export function parseMasterWorkbook(file: Buffer): { sheets: Record<MasterKind, ParsedSheet>; fileError?: string } {
  const empty = (): ParsedSheet => ({ found: false, rows: [], errors: [] });
  const sheets: Record<MasterKind, ParsedSheet> = { CLIENT: empty(), MEDIA: empty(), LOCATION: empty() };
  let wb: xlsx.WorkBook;
  try {
    // Stop parsing a little past the row cap, and skip formulas, HTML and styles: a small file
    // can declare a huge range, and reading all of it would starve the single API process.
    // Reading past MAX_ROWS still lets parseMasterSheet report "too many rows".
    wb = xlsx.read(file, { type: "buffer", sheetRows: MAX_ROWS + 100, cellFormula: false, cellHTML: false, cellStyles: false });
  } catch {
    return { sheets, fileError: "Could not read the file. Make sure it is a valid Excel file." };
  }
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  for (const kind of Object.keys(SHEET_NAMES) as MasterKind[]) {
    const sheetName =
      wb.SheetNames.find((n) => norm(n) === norm(SHEET_NAMES[kind])) ?? wb.SheetNames.find((n) => SHEET_ALIASES[kind].includes(norm(n)));
    if (!sheetName) continue;
    const sheet = wb.Sheets[sheetName]!;
    capColumns(sheet);
    const first = sheet["!ref"] ? xlsx.utils.decode_range(sheet["!ref"]).s.r + 1 : 1;
    // Formatted text, not raw values: a code typed as 088 stays "088" when the cell is text.
    const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
    sheets[kind] = parseMasterSheet(kind, rows, first);
  }
  if (!Object.values(sheets).some((s) => s.found)) {
    return { sheets, fileError: "This file has no Clients, Media or Locations sheet. Download the template and use that." };
  }
  return { sheets };
}

// ---------------------------------------------------------------------------
// Planning: what an import would change, against what is in the list now
// ---------------------------------------------------------------------------

export interface ExistingEntry {
  id: number;
  name: string;
  is_active: boolean;
  code?: string | null;
  locality?: Locality;
  district?: string | null;
  needs_confirmation?: boolean;
  short_name?: string | null;
  contact_person?: string | null;
  contact_number?: string | null;
  email?: string | null;
  csm_name?: string | null;
  default_machine_id?: number | null;
  state?: string | null;
}

/** Extra fields an add or update writes, by column name. */
export type ExtraData = Partial<Record<"short_name" | "contact_person" | "contact_number" | "email" | "csm_name" | "state", string | null>> & {
  default_machine_id?: number | null;
};

export interface PlannedAdd {
  row: number;
  name: string;
  data: { name: string; code?: string | null; is_active: boolean; locality?: Locality; district?: string | null; needs_confirmation?: boolean } & ExtraData;
  detail: string;
}

export interface PlannedUpdate {
  row: number;
  id: number;
  name: string;
  data: { code?: string; is_active?: boolean; locality?: Locality; district?: string; needs_confirmation?: boolean } & ExtraData;
  detail: string;
}

export interface SheetPlan {
  adds: PlannedAdd[];
  updates: PlannedUpdate[];
  unchanged: number;
  errors: RowError[];
}

const LOC = LOCALITY_SHEET_LABELS;

/** Works out the adds and updates for one parsed sheet. Pure: the caller loads `existing`. */
export function planSheet(
  kind: MasterKind,
  sheet: ParsedSheet,
  existing: ExistingEntry[],
  ctx: { machines?: Map<string, { id: number; name: string }> } = {},
): SheetPlan {
  const plan: SheetPlan = { adds: [], updates: [], unchanged: 0, errors: [...sheet.errors] };
  const byLower = new Map<string, ExistingEntry>();
  const byKey = new Map<string, ExistingEntry>();
  const byCode = new Map<string, ExistingEntry>();
  for (const e of existing) {
    if (!byLower.has(lowerKey(e.name))) byLower.set(lowerKey(e.name), e);
    if (!byKey.has(nameKey(e.name))) byKey.set(nameKey(e.name), e);
    if (e.code) byCode.set(e.code.toUpperCase(), e);
  }

  for (const r of sheet.rows) {
    const fail = (message: string) => plan.errors.push({ row: r.row, message });
    const current = byLower.get(lowerKey(r.name));

    if (!current) {
      const similar = byKey.get(nameKey(r.name));
      if (similar) {
        fail(`Looks the same as "${similar.name}" in the list. Use that spelling, or edit it in the Master Library.`);
        continue;
      }
      if (r.code && byCode.has(r.code)) {
        fail(`Code ${r.code} is already used by "${byCode.get(r.code)!.name}".`);
        continue;
      }
      const active = r.active ?? true;
      const notes: string[] = [];
      const add: PlannedAdd = { row: r.row, name: r.name, data: { name: r.name, is_active: active }, detail: "" };
      if (kind === "CLIENT") {
        add.data.code = r.code ?? null;
        if (r.code) notes.push(`Code ${r.code}`);
      }
      if (kind === "LOCATION") {
        add.data.locality = r.locality ?? "LOCAL";
        add.data.district = r.district || null;
        add.data.needs_confirmation = !r.locality;
        notes.push(r.locality ? LOC[r.locality] : "Needs review: Hyderabad or Non-local not given");
        if (r.district) notes.push(r.district);
      }
      const extras = extrasOf(kind, r, ctx);
      if (extras.error) {
        fail(extras.error);
        continue;
      }
      Object.assign(add.data, extras.data);
      notes.push(...extras.notes);
      if (!active) notes.push("Archived");
      add.detail = notes.join(" · ");
      plan.adds.push(add);
      continue;
    }

    const data: PlannedUpdate["data"] = {};
    const notes: string[] = [];
    if (kind === "CLIENT" && r.code && r.code !== (current.code ?? "").toUpperCase()) {
      const owner = byCode.get(r.code);
      if (owner && owner.id !== current.id) {
        fail(`Code ${r.code} is already used by "${owner.name}".`);
        continue;
      }
      data.code = r.code;
      notes.push(`Code ${current.code || "—"} → ${r.code}`);
    }
    if (kind === "LOCATION") {
      if (r.locality && (r.locality !== current.locality || current.needs_confirmation)) {
        data.locality = r.locality;
        data.needs_confirmation = false;
        notes.push(
          current.needs_confirmation || !current.locality
            ? `${LOC[r.locality]} (confirmed)`
            : `${LOC[current.locality]} → ${LOC[r.locality]}`,
        );
      }
      if (r.district && r.district !== (current.district ?? "")) {
        data.district = r.district;
        notes.push(`District ${current.district || "—"} → ${r.district}`);
      }
    }
    const extras = extrasOf(kind, r, ctx);
    if (extras.error) {
      fail(extras.error);
      continue;
    }
    for (const [field, value] of Object.entries(extras.data) as [keyof ExtraData, string | number | null][]) {
      const was = (current as unknown as Record<string, unknown>)[field] ?? null;
      if (field === "default_machine_id" ? was === value : String(was ?? "") === String(value ?? "")) continue;
      (data as Record<string, unknown>)[field] = value;
      const x = EXTRAS[kind].find((e) => e.field === field || (field === "default_machine_id" && e.field === "machine"));
      notes.push(`${x?.label ?? field} → ${field === "default_machine_id" ? r.extra?.machine : value}`);
    }
    if (r.active !== undefined && r.active !== current.is_active) {
      data.is_active = r.active;
      notes.push(r.active ? "Restored" : "Archived");
    }
    if (notes.length === 0) {
      plan.unchanged++;
      continue;
    }
    plan.updates.push({ row: r.row, id: current.id, name: current.name, data, detail: notes.join(" · ") });
  }
  plan.errors.sort((a, b) => a.row - b.row);
  return plan;
}

/** The filled extra columns of one row, as fields; a machine name becomes its id. */
function extrasOf(kind: MasterKind, r: SheetRow, ctx: { machines?: Map<string, { id: number; name: string }> }) {
  const data: ExtraData = {};
  const notes: string[] = [];
  for (const [field, value] of Object.entries(r.extra ?? {})) {
    if (field === "machine") {
      const m = ctx.machines?.get(value.toLowerCase());
      if (!m) return { data, notes, error: `Machine "${value}" is not in the machine list.` };
      data.default_machine_id = m.id;
      notes.push(m.name);
      continue;
    }
    (data as Record<string, string>)[field] = value;
    if (kind === "CLIENT" && field === "csm_name") notes.push(`CSM ${value}`);
    if (kind === "LOCATION" && field === "state") notes.push(value);
  }
  return { data, notes, error: null as string | null };
}

// ---------------------------------------------------------------------------
// Writing the workbook
// ---------------------------------------------------------------------------

export interface WorkbookData {
  clients: {
    name: string;
    code: string | null;
    is_active: boolean;
    short_name?: string | null;
    contact_person?: string | null;
    contact_number?: string | null;
    email?: string | null;
    csm_name?: string | null;
  }[];
  media: { name: string; is_active: boolean; machine?: string | null }[];
  locations: { name: string; locality: Locality; district: string | null; state?: string | null; needs_confirmation: boolean; is_active: boolean }[];
}

const yes = (b: boolean) => (b ? "Yes" : "No");

/**
 * The three sheets, plus a short guide (ignored on import). With no data it is the template:
 * one example row per sheet, which the import skips.
 */
export function buildMasterWorkbook(data?: WorkbookData): Buffer {
  const template = !data;
  const clients = template
    ? [["Example: Big C", "SBD999", "Big C", "Ravi", "9800000000", "accounts@bigc.example", "Sunil", "Yes"]]
    : data.clients.map((c) => [
        c.name,
        c.code ?? "",
        c.short_name ?? "",
        c.contact_person ?? "",
        c.contact_number ?? "",
        c.email ?? "",
        c.csm_name ?? "",
        yes(c.is_active),
      ]);
  const media = template ? [["Example: Star Flex", "Solvent", "Yes"]] : data.media.map((m) => [m.name, m.machine ?? "", yes(m.is_active)]);
  // A location still waiting for review goes out with the locality blank, so re-importing the
  // export does not confirm the placeholder by accident.
  const locations = template
    ? [["Example: Ameerpet", "Hyderabad", "Hyderabad", "Telangana", "Yes"]]
    : data.locations.map((l) => [l.name, l.needs_confirmation ? "" : LOC[l.locality], l.district ?? "", l.state ?? "", yes(l.is_active)]);

  const wb = xlsx.utils.book_new();
  const add = (kind: MasterKind, rows: unknown[][], widths: number[]) => {
    const ws = xlsx.utils.aoa_to_sheet([SHEET_HEADERS[kind], ...rows]);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    xlsx.utils.book_append_sheet(wb, ws, SHEET_NAMES[kind]);
  };
  add("CLIENT", clients, [40, 10, 18, 20, 16, 30, 16, 8]);
  add("MEDIA", media, [40, 18, 8]);
  add("LOCATION", locations, [36, 22, 22, 16, 8]);

  const guide = xlsx.utils.aoa_to_sheet([
    ["How this file is read"],
    [],
    ["Clients, Media and Locations each have their own sheet. Type one name per row."],
    ["A new name is added. A name already in the list (capitals do not matter) gets its other columns updated."],
    ["A blank cell leaves that value as it is. Nothing is ever deleted. Blank rows are skipped."],
    ["Code: letters, numbers, - and _ only. A new client with no code gets the next SBD number."],
    ["Default Machine (line items): CNC, Epson, Solvent, UV Machine, Outward or Order Sheet."],
    ["The company's own sheets (OMS Clients Data, OMS Line Items, Locations) are read as they are."],
    ["Hyderabad / Non-local: write Hyderabad or Non-local. Left blank on a new location, it is marked for review."],
    ["Active: Yes or No. No archives the name: it stays on old orders but leaves the pick-lists."],
    ["Rows starting with \"Example:\" are skipped."],
    ["You will see what changes on a preview screen before anything is saved."],
  ]);
  guide["!cols"] = [{ wch: 110 }];
  xlsx.utils.book_append_sheet(wb, guide, "How to fill");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}
