import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { notifyNameRequestDecided, notifyNameRequested } from "../services/notifications.service";
import { sendClientWelcomeEmail } from "../services/email.service";
import {
  KIND_LABELS,
  MASTER_KINDS,
  cleanName,
  findDuplicateGroups,
  groupSignature,
  lowerKey,
  nameKey,
  type MasterKind,
} from "../utils/master-names";
import {
  SHEET_NAMES,
  buildMasterWorkbook,
  parseMasterWorkbook,
  planSheet,
  type ExistingEntry,
  type SheetPlan,
} from "../utils/master-workbook";
import {
  approveRequestSchema,
  clientEntrySchema,
  locationEntrySchema,
  mediaEntrySchema,
  mergeSchema,
  nameRequestSchema,
  requestDetailsSchema,
  notSameSchema,
  rejectRequestSchema,
} from "../utils/validators-master";

/**
 * The Master Library: the admin's official spellings of clients, media and locations, so the
 * same client is not split across reports by a second spelling. Orders keep the names as text
 * (Order.client_name, OrderItem.media, OrderStore.location), so renaming or merging a name
 * rewrites those columns too, in the same transaction. Field jobs point at a location by id.
 *
 * Every write sets app.current_user_id first, so the audit triggers on Order, OrderItem,
 * OrderStore, Area and WorkJob attribute each row they log. Client and Media have no trigger,
 * so their changes are written to the audit log here.
 */

type Db = Prisma.TransactionClient;
type Locality = "LOCAL" | "NON_LOCAL";

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

function fail(res: Response, err: unknown) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  const code = (err as { code?: string })?.code;
  if (code === "P2002") return res.status(409).json({ message: "That name or code is already in the list. Reload and try again." });
  if (code === "P2025") return res.status(404).json({ message: "Not found. It may have been merged or removed." });
  console.error("Master Library error:", err);
  return res.status(500).json({ message: "Internal server error" });
}

const badInput = (res: Response, error: Parameters<typeof sanitizeZodErrors>[0]) =>
  res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(error) });

/** Renames and merges can rewrite thousands of order rows, each one logged by its trigger. */
const LONG_TX = { timeout: 120_000, maxWait: 10_000 };

async function withAudit<T>(userId: number, fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId.toString()}, true)`;
    return fn(tx);
  }, LONG_TX);
}

const TABLE: Record<MasterKind, string> = { CLIENT: "Client", MEDIA: "Media", LOCATION: "Area" };

async function audit(
  tx: Db,
  user: { id: number; username: string },
  kind: MasterKind,
  recordId: number,
  action: string,
  oldData: Prisma.InputJsonValue | null,
  newData: Prisma.InputJsonValue | null,
) {
  await tx.auditLog.create({
    data: {
      table_name: TABLE[kind],
      record_id: recordId,
      action,
      changed_by: user.id,
      user_name: user.username,
      old_data: oldData ?? Prisma.DbNull,
      new_data: newData ?? Prisma.DbNull,
    },
  });
}

const KIND_FROM_PATH: Record<string, MasterKind> = { clients: "CLIENT", media: "MEDIA", locations: "LOCATION" };

function kindOf(req: Request): MasterKind {
  const kind = KIND_FROM_PATH[String(req.params.kind)];
  if (!kind) throw new HttpError(404, "Not found");
  return kind;
}

function idOf(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

/** What each kind's entry carries, everywhere it is read or written. */
const CLIENT_SELECT = {
  id: true,
  name: true,
  code: true,
  is_active: true,
  updated_at: true,
  short_name: true,
  contact_person: true,
  contact_number: true,
  email: true,
  csm_name: true,
  block_orders: true,
  pending_block_days: true,
  payment_block_days: true,
} as const;
const MEDIA_SELECT = { id: true, name: true, is_active: true, updated_at: true, default_machine_id: true } as const;
const AREA_SELECT = { id: true, name: true, locality: true, district: true, state: true, needs_confirmation: true, is_active: true, updated_at: true } as const;

/** Client codes run SBD001, SBD002, ...: the next free ones after the highest in use. */
async function nextClientCodes(db: Db, count: number, taken: Iterable<string> = []): Promise<string[]> {
  const rows = await db.client.findMany({ where: { code: { startsWith: "SBD" } }, select: { code: true } });
  const used = new Set<string>([...rows.map((r) => (r.code ?? "").toUpperCase()), ...[...taken].map((c) => c.toUpperCase())]);
  let n = 0;
  for (const c of used) {
    const m = /^SBD(\d+)$/.exec(c);
    if (m) n = Math.max(n, Number(m[1]));
  }
  const out: string[] = [];
  while (out.length < count) {
    n++;
    const code = `SBD${String(n).padStart(3, "0")}`;
    if (!used.has(code)) out.push(code);
  }
  return out;
}

const CLIENT_EXTRA = ["short_name", "contact_person", "contact_number", "email", "csm_name"] as const;
/** The client columns a body carries (undefined when not given, so an edit leaves the rest). */
const clientExtras = (d: Record<string, unknown>) =>
  Object.fromEntries(CLIENT_EXTRA.filter((k) => d[k] !== undefined).map((k) => [k, (d[k] as string | null) ?? null]));

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name);

// ---------------------------------------------------------------------------
// Entries and how often each is used
// ---------------------------------------------------------------------------

interface Entry extends ExistingEntry {
  updated_at: Date;
}

async function loadEntries(db: Db, kind: MasterKind, ids?: number[]): Promise<Entry[]> {
  const where = ids ? { id: { in: ids } } : {};
  if (kind === "CLIENT") {
    return db.client.findMany({ where, select: CLIENT_SELECT });
  }
  if (kind === "MEDIA") {
    return db.media.findMany({ where, select: MEDIA_SELECT });
  }
  return db.area.findMany({
    where,
    select: AREA_SELECT,
  });
}

/** Where each kind's name is written on orders. Fixed identifiers, never user input. */
const NAME_COLUMN: Record<MasterKind, { table: string; column: string; uses: "orders" | "items" | "stores" }> = {
  CLIENT: { table: "Order", column: "client_name", uses: "orders" },
  MEDIA: { table: "OrderItem", column: "media", uses: "items" },
  LOCATION: { table: "OrderStore", column: "location", uses: "stores" },
};

/** The SQL twin of lowerKey(): trimmed, single-spaced, lower case. */
const normalised = (column: string) => Prisma.raw(`lower(btrim(regexp_replace("${column}", '\\s+', ' ', 'g')))`);

type Uses = Partial<Record<"orders" | "items" | "stores" | "jobs", number>>;

async function usageOf(db: Db, kind: MasterKind): Promise<(e: Entry) => Uses> {
  const { table, column, uses } = NAME_COLUMN[kind];
  const rows = await db.$queryRaw<{ k: string; n: number }[]>`
    SELECT ${normalised(column)} AS k, count(*)::int AS n FROM ${Prisma.raw(`"${table}"`)} GROUP BY 1`;
  const byName = new Map(rows.map((r) => [r.k, Number(r.n)]));
  let jobs = new Map<number, number>();
  if (kind === "LOCATION") {
    const grouped = await db.workJob.groupBy({ by: ["area_id"], where: { area_id: { not: null } }, _count: { _all: true } });
    jobs = new Map(grouped.map((g) => [g.area_id!, g._count._all]));
  }
  return (e) => {
    const out: Uses = { [uses]: byName.get(lowerKey(e.name)) ?? 0 };
    if (kind === "LOCATION") out.jobs = jobs.get(e.id) ?? 0;
    return out;
  };
}

const total = (u: Uses) => Object.values(u).reduce((s, n) => s + (n ?? 0), 0);

/** The fields worth keeping in the audit log, without the ones a kind does not have. */
function snapshot(e: Entry): Prisma.InputJsonObject {
  const out: Record<string, string | boolean | null> = { name: e.name, is_active: e.is_active };
  if (e.code !== undefined) out.code = e.code;
  if (e.locality !== undefined) out.locality = e.locality;
  if (e.district !== undefined) out.district = e.district;
  if (e.needs_confirmation !== undefined) out.needs_confirmation = e.needs_confirmation;
  return out;
}

function present(e: Entry, uses: Uses) {
  return { ...e, usage: total(uses), uses };
}

async function entriesWithUsage(db: Db, kind: MasterKind) {
  const [entries, usage] = await Promise.all([loadEntries(db, kind), usageOf(db, kind)]);
  return entries.map((e) => present(e, usage(e))).sort(byName);
}

/**
 * Rewrites every order row carrying one of `fromLower` (compared as lowerKey) to `to`. Rows that
 * already read exactly `to` are left alone, so the audit log only shows real changes.
 */
async function rewriteNames(tx: Db, kind: MasterKind, fromLower: string[], to: string): Promise<number> {
  if (fromLower.length === 0) return 0;
  const { table, column } = NAME_COLUMN[kind];
  const col = Prisma.raw(`"${column}"`);
  return tx.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)} SET ${col} = ${to}
    WHERE ${normalised(column)} IN (${Prisma.join(fromLower)}) AND ${col} <> ${to}`;
}

/**
 * The uniqueness rule: no two names alike ignoring case, and none that differ only by spaces or
 * punctuation ("Big C" / "BigC"). Throws with the existing spelling so the screen can show it.
 */
function assertNameFree(entries: Entry[], name: string, exceptId?: number) {
  const others = entries.filter((e) => e.id !== exceptId);
  const same = others.find((e) => lowerKey(e.name) === lowerKey(name));
  if (same) throw new HttpError(409, `"${same.name}" is already in the list.`, { existing: same.name });
  const alike = others.find((e) => nameKey(e.name) === nameKey(name));
  if (alike) {
    throw new HttpError(409, `This looks the same as "${alike.name}", already in the list. Use that one, or merge them in Duplicates.`, {
      existing: alike.name,
    });
  }
}

async function assertCodeFree(tx: Db, code: string | null | undefined, exceptId?: number) {
  if (!code) return;
  const owner = await tx.client.findFirst({ where: { code, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { name: true } });
  if (owner) throw new HttpError(409, `Code ${code} is already used by "${owner.name}".`);
}

// ---------------------------------------------------------------------------
// Lists, add, edit, archive
// ---------------------------------------------------------------------------

/**
 * GET /api/master-library/:kind (clients | media | locations)
 * ?q= search · ?status=active|archived|all (default all) · ?review=true (locations needing review)
 */
export const listEntries = async (req: Request, res: Response) => {
  try {
    const kind = kindOf(req);
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const status = String(req.query.status ?? "all");
    const review = req.query.review === "true";
    const entries = (await entriesWithUsage(prisma, kind)).filter(
      (e) =>
        (status === "active" ? e.is_active : status === "archived" ? !e.is_active : true) &&
        (!review || e.needs_confirmation) &&
        (!q || `${e.name} ${e.code ?? ""} ${e.district ?? ""}`.toLowerCase().includes(q)),
    );
    return res.status(200).json({ entries });
  } catch (err) {
    return fail(res, err);
  }
};

const schemaFor = (kind: MasterKind) =>
  kind === "CLIENT" ? clientEntrySchema : kind === "MEDIA" ? mediaEntrySchema : locationEntrySchema;

type EntryInput = {
  name?: string;
  code?: string | null;
  locality?: Locality;
  district?: string | null;
  state?: string | null;
  is_active?: boolean;
  default_machine_id?: number | null;
  block_orders?: boolean;
  pending_block_days?: number;
  payment_block_days?: number;
} & Partial<Record<(typeof CLIENT_EXTRA)[number], string | null>>;

async function createEntry(tx: Db, kind: MasterKind, d: EntryInput & { name: string; needs_confirmation?: boolean }): Promise<Entry> {
  const is_active = d.is_active ?? true;
  if (kind === "CLIENT") {
    const code = d.code || (await nextClientCodes(tx, 1))[0]!;
    return tx.client.create({
      data: { name: d.name, code, is_active, ...clientExtras(d) },
      select: CLIENT_SELECT,
    });
  }
  if (kind === "MEDIA") {
    return tx.media.create({ data: { name: d.name, is_active, default_machine_id: d.default_machine_id ?? null }, select: MEDIA_SELECT });
  }
  return tx.area.create({
    data: {
      name: d.name,
      locality: d.locality ?? "LOCAL",
      district: d.district ?? null,
      state: d.state ?? null,
      // No locality given (a request approved without one): keep the placeholder flagged.
      needs_confirmation: d.needs_confirmation ?? !d.locality,
      is_active,
    },
    select: AREA_SELECT,
  });
}

/** POST /api/master-library/:kind — add a name. */
export const createMasterEntry = async (req: Request, res: Response) => {
  try {
    const kind = kindOf(req);
    const parsed = schemaFor(kind).safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    const d = parsed.data as EntryInput & { name: string };
    const user = req.user!;
    const entry = await withAudit(user.id, async (tx) => {
      assertNameFree(await loadEntries(tx, kind), d.name);
      if (kind === "CLIENT") await assertCodeFree(tx, d.code);
      const created = await createEntry(tx, kind, { ...d, needs_confirmation: false });
      await audit(tx, user, kind, created.id, "INSERT", null, snapshot(created));
      return created;
    });
    const usage = await usageOf(prisma, kind);
    return res.status(201).json({ entry: present(entry, usage(entry)) });
  } catch (err) {
    return fail(res, err);
  }
};

/**
 * PATCH /api/master-library/:kind/:id — edit, rename, archive or restore. A rename is a spelling
 * fix: every order row with the old name (ignoring case) gets the new one. Saving a location's
 * locality marks it reviewed.
 */
export const updateMasterEntry = async (req: Request, res: Response) => {
  try {
    const kind = kindOf(req);
    const id = idOf(req);
    const parsed = schemaFor(kind).partial().safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    const d = parsed.data as EntryInput;
    const user = req.user!;

    const result = await withAudit(user.id, async (tx) => {
      const all = await loadEntries(tx, kind);
      const current = all.find((e) => e.id === id);
      if (!current) throw new HttpError(404, "Not found. It may have been merged or removed.");

      const renamed = d.name !== undefined && d.name !== current.name;
      if (renamed && lowerKey(d.name!) !== lowerKey(current.name)) assertNameFree(all, d.name!, id);

      let updated: Entry;
      if (kind === "CLIENT") {
        if (d.code !== undefined && d.code !== current.code) await assertCodeFree(tx, d.code, id);
        updated = await tx.client.update({
          where: { id },
          data: {
            name: d.name,
            code: d.code,
            is_active: d.is_active,
            ...clientExtras(d),
            block_orders: d.block_orders,
            pending_block_days: d.pending_block_days,
            payment_block_days: d.payment_block_days,
          },
          select: CLIENT_SELECT,
        });
      } else if (kind === "MEDIA") {
        updated = await tx.media.update({
          where: { id },
          data: { name: d.name, is_active: d.is_active, default_machine_id: d.default_machine_id },
          select: MEDIA_SELECT,
        });
      } else {
        updated = await tx.area.update({
          where: { id },
          data: {
            name: d.name,
            locality: d.locality,
            district: d.district,
            state: d.state,
            is_active: d.is_active,
            ...(d.locality ? { needs_confirmation: false } : {}),
          },
          select: AREA_SELECT,
        });
      }

      const moved = renamed ? await rewriteNames(tx, kind, [lowerKey(current.name)], updated.name) : 0;
      // Area has its own audit trigger; Client and Media are logged here.
      if (kind !== "LOCATION") {
        await audit(
          tx,
          user,
          kind,
          id,
          renamed ? "RENAME" : "UPDATE",
          { name: current.name, code: current.code ?? null, is_active: current.is_active },
          { name: updated.name, code: updated.code ?? null, is_active: updated.is_active, ...(renamed ? { rows_renamed: moved } : {}) },
        );
      }
      return { updated, moved };
    });
    const usage = await usageOf(prisma, kind);
    return res.status(200).json({ entry: present(result.updated, usage(result.updated)), moved: result.moved });
  } catch (err) {
    return fail(res, err);
  }
};

// ---------------------------------------------------------------------------
// Duplicates and merge
// ---------------------------------------------------------------------------

/** Groups the admin marked "not the same", per kind, kept as group signatures. */
const NOT_SAME_KEY = "master_not_same";
type NotSame = Partial<Record<MasterKind, string[]>>;

async function loadNotSame(db: Db): Promise<NotSame> {
  const row = await db.appSetting.findUnique({ where: { key: NOT_SAME_KEY } });
  const v = row?.value;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as NotSame) : {};
}

/** GET /api/master-library/duplicates — near-identical names, grouped, for every kind. */
export const listDuplicates = async (_req: Request, res: Response) => {
  try {
    const notSame = await loadNotSame(prisma);
    const groups = [];
    for (const kind of MASTER_KINDS) {
      const entries = await entriesWithUsage(prisma, kind);
      for (const members of findDuplicateGroups(entries, new Set(notSame[kind] ?? []))) {
        groups.push({ kind, signature: groupSignature(members.map((m) => m.name)), members });
      }
    }
    return res.status(200).json({ groups });
  } catch (err) {
    return fail(res, err);
  }
};

/** POST /api/master-library/duplicates/not-same {kind, ids} — hide a group the admin says are different names. */
export const markNotSame = async (req: Request, res: Response) => {
  try {
    const parsed = notSameSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    const { kind, ids } = parsed.data;
    const user = req.user!;
    await withAudit(user.id, async (tx) => {
      const entries = await loadEntries(tx, kind, ids);
      if (entries.length < 2) throw new HttpError(404, "These names have changed. Reload and try again.");
      const all = await loadNotSame(tx);
      const list = [...new Set([...(all[kind] ?? []), groupSignature(entries.map((e) => e.name))])].slice(-2000);
      const value = { ...all, [kind]: list } as Prisma.InputJsonValue;
      await tx.appSetting.upsert({
        where: { key: NOT_SAME_KEY },
        create: { key: NOT_SAME_KEY, value, updated_by: user.id },
        update: { value, updated_by: user.id },
      });
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return fail(res, err);
  }
};

/**
 * POST /api/master-library/merge {kind, keep_id, merge_ids} — keep one spelling and fold the
 * others in: order rows get the kept spelling, field jobs move to the kept location, and the
 * merged names are deleted. One transaction.
 */
export const mergeEntries = async (req: Request, res: Response) => {
  try {
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    const { kind, keep_id } = parsed.data;
    const mergeIds = [...new Set(parsed.data.merge_ids)].filter((id) => id !== keep_id);
    if (mergeIds.length === 0) return res.status(400).json({ message: "Pick at least one other spelling to fold in." });
    const user = req.user!;

    const result = await withAudit(user.id, async (tx) => {
      const found = await loadEntries(tx, kind, [keep_id, ...mergeIds]);
      const keep = found.find((e) => e.id === keep_id);
      const gone = found.filter((e) => e.id !== keep_id);
      if (!keep || gone.length !== mergeIds.length) {
        throw new HttpError(409, "Some of these names were changed or merged already. Reload and try again.");
      }

      // The kept spelling's own case variants on orders are tidied up as well.
      const from = [...new Set([keep, ...gone].map((e) => lowerKey(e.name)))];
      const rows = await rewriteNames(tx, kind, from, keep.name);
      const moved: Uses = { [NAME_COLUMN[kind].uses]: rows };

      if (kind === "CLIENT") {
        await tx.client.deleteMany({ where: { id: { in: mergeIds } } });
        // A code on a merged spelling is not lost when the kept one has none.
        const code = keep.code ? null : gone.find((g) => g.code)?.code;
        if (code) await tx.client.update({ where: { id: keep.id }, data: { code } });
      } else if (kind === "MEDIA") {
        await tx.media.deleteMany({ where: { id: { in: mergeIds } } });
      } else {
        // WorkJob.area_id is ON DELETE RESTRICT, so jobs move before the areas go.
        moved.jobs = (await tx.workJob.updateMany({ where: { area_id: { in: mergeIds } }, data: { area_id: keep.id } })).count;
        await tx.area.deleteMany({ where: { id: { in: mergeIds } } });
        // Keeping a spelling still marked for review: take a reviewed one's locality.
        const reviewed = gone.find((g) => !g.needs_confirmation);
        const district = keep.district || gone.find((g) => g.district)?.district || null;
        const data: Prisma.AreaUpdateInput = {};
        if (keep.needs_confirmation && reviewed) Object.assign(data, { locality: reviewed.locality, needs_confirmation: false });
        if (district !== (keep.district ?? null)) data.district = district;
        if (Object.keys(data).length) await tx.area.update({ where: { id: keep.id }, data });
      }

      await audit(
        tx,
        user,
        kind,
        keep.id,
        "MERGE",
        { merged: gone.map((g) => ({ id: g.id, name: g.name })) },
        { kept: keep.name, moved } as Prisma.InputJsonValue,
      );
      const [kept] = await loadEntries(tx, kind, [keep.id]);
      return { kept: kept!, moved };
    });

    const usage = await usageOf(prisma, kind);
    return res.status(200).json({ kept: present(result.kept, usage(result.kept)), merged: mergeIds.length, moved: result.moved });
  } catch (err) {
    return fail(res, err);
  }
};

// ---------------------------------------------------------------------------
// Template, export, import
// ---------------------------------------------------------------------------

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** GET /api/master-library/template — the three sheets, headings and one example row each. */
export const masterTemplate = async (_req: Request, res: Response) => {
  try {
    res.setHeader("Content-Disposition", "attachment; filename=Master_Library_Template.xlsx");
    res.setHeader("Content-Type", XLSX_TYPE);
    return res.send(buildMasterWorkbook());
  } catch (err) {
    return fail(res, err);
  }
};

/** GET /api/master-library/export — every name, archived ones too, in the template's format. */
export const masterExport = async (_req: Request, res: Response) => {
  try {
    const [clients, media, locations] = await Promise.all([
      prisma.client.findMany({
        select: { name: true, code: true, is_active: true, short_name: true, contact_person: true, contact_number: true, email: true, csm_name: true },
      }),
      prisma.media.findMany({ select: { name: true, is_active: true, defaultMachine: { select: { name: true } } } }),
      prisma.area.findMany({ select: { name: true, locality: true, district: true, state: true, needs_confirmation: true, is_active: true } }),
    ]);
    const buffer = buildMasterWorkbook({
      clients: clients.sort(byName),
      media: media.map((m) => ({ name: m.name, is_active: m.is_active, machine: m.defaultMachine?.name ?? null })).sort(byName),
      locations: locations.sort(byName),
    });
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename=Master_Library_${day}.xlsx`);
    res.setHeader("Content-Type", XLSX_TYPE);
    return res.send(buffer);
  } catch (err) {
    return fail(res, err);
  }
};

function uploadedFile(req: Request): Buffer {
  const buf = req.body;
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    throw new HttpError(400, "No file received. Upload the .xlsx file as the request body.");
  }
  return buf;
}

async function planImport(db: Db, file: Buffer) {
  const { sheets, fileError } = parseMasterWorkbook(file);
  if (fileError) throw new HttpError(400, fileError);
  const plans: Partial<Record<MasterKind, SheetPlan>> = {};
  const machines = new Map((await db.machine.findMany({ select: { id: true, name: true } })).map((m) => [m.name.toLowerCase(), m]));
  for (const kind of MASTER_KINDS) {
    const sheet = sheets[kind];
    if (sheet.found && !sheet.problem) plans[kind] = planSheet(kind, sheet, await loadEntries(db, kind), { machines });
  }
  return { sheets, plans };
}

const MAX_LISTED = 500;

function importSummary({ sheets, plans }: Awaited<ReturnType<typeof planImport>>) {
  return MASTER_KINDS.map((kind) => {
    const plan = plans[kind];
    const changes = plan
      ? [
          ...plan.adds.map((a) => ({ row: a.row, name: a.name, action: "add" as const, detail: a.detail })),
          ...plan.updates.map((u) => ({ row: u.row, name: u.name, action: "update" as const, detail: u.detail })),
        ].sort((a, b) => a.row - b.row)
      : [];
    return {
      kind,
      sheet: SHEET_NAMES[kind],
      found: sheets[kind].found,
      problem: sheets[kind].problem ?? null,
      add: plan?.adds.length ?? 0,
      update: plan?.updates.length ?? 0,
      unchanged: plan?.unchanged ?? 0,
      error_count: plan?.errors.length ?? 0,
      errors: (plan?.errors ?? []).slice(0, 200),
      changes: changes.slice(0, MAX_LISTED),
      more_changes: Math.max(0, changes.length - MAX_LISTED),
    };
  });
}

/** POST /api/master-library/import/preview — reads the file and saves nothing. */
export const previewMasterImport = async (req: Request, res: Response) => {
  try {
    const plan = await planImport(prisma, uploadedFile(req));
    return res.status(200).json({ sheets: importSummary(plan) });
  } catch (err) {
    return fail(res, err);
  }
};

/**
 * POST /api/master-library/import — the same file again, applied. It is planned afresh inside
 * the transaction, so it acts on the list as it is now, not as it was at preview. Rows with
 * errors are skipped; nothing is deleted.
 */
export const applyMasterImport = async (req: Request, res: Response) => {
  try {
    const file = uploadedFile(req);
    const user = req.user!;
    const plan = await withAudit(user.id, async (tx) => {
      const plan = await planImport(tx, file);
      for (const kind of MASTER_KINDS) {
        const p = plan.plans[kind];
        if (!p || (p.adds.length === 0 && p.updates.length === 0)) continue;
        const adds = p.adds.map((a) => a.data);
        if (kind === "CLIENT") {
          // A new client without a code in the sheet takes the next SBD number.
          const fresh = await nextClientCodes(tx, adds.filter((a) => !a.code).length, adds.map((a) => a.code ?? "").filter(Boolean));
          await tx.client.createMany({
            data: adds.map((a) => ({ name: a.name, code: a.code || fresh.shift()!, is_active: a.is_active, ...clientExtras(a) })),
          });
        } else if (kind === "MEDIA") {
          await tx.media.createMany({ data: adds.map((a) => ({ name: a.name, is_active: a.is_active, default_machine_id: a.default_machine_id ?? null })) });
        }
        else {
          await tx.area.createMany({
            data: adds.map((a) => ({
              name: a.name,
              locality: a.locality ?? "LOCAL",
              district: a.district ?? null,
              state: a.state ?? null,
              needs_confirmation: a.needs_confirmation ?? true,
              is_active: a.is_active,
            })),
          });
        }
        for (const u of p.updates) {
          if (kind === "CLIENT") await tx.client.update({ where: { id: u.id }, data: { code: u.data.code, is_active: u.data.is_active, ...clientExtras(u.data) } });
          else if (kind === "MEDIA") await tx.media.update({ where: { id: u.id }, data: { is_active: u.data.is_active, default_machine_id: u.data.default_machine_id } });
          else await tx.area.update({ where: { id: u.id }, data: u.data });
        }
        await audit(tx, user, kind, 0, "IMPORT", null, {
          added: p.adds.slice(0, 200).map((a) => a.name),
          updated: p.updates.slice(0, 200).map((u) => ({ name: u.name, change: u.detail })),
          counts: { added: p.adds.length, updated: p.updates.length, errors: p.errors.length },
        });
      }
      return plan;
    });
    return res.status(200).json({ applied: true, sheets: importSummary(plan) });
  } catch (err) {
    return fail(res, err);
  }
};

// ---------------------------------------------------------------------------
// Name requests
// ---------------------------------------------------------------------------

const requestInclude = {
  requester: { select: { id: true, name: true } },
  decider: { select: { id: true, name: true } },
} as const;

/** The existing name a request matches: the same ignoring case, or the same once spaces and punctuation go. */
function matchOf(entries: Entry[], name: string): Entry | undefined {
  return entries.find((e) => lowerKey(e.name) === lowerKey(name)) ?? entries.find((e) => nameKey(e.name) === nameKey(name));
}

/**
 * POST /api/master-library/requests {kind, name, note?} — a CSM, Operation Manager or Admin asks
 * for a name missing from a pick-list. Refused when the name is already there (the reply carries
 * the existing spelling) or someone has already asked for it.
 */
export const createNameRequest = async (req: Request, res: Response) => {
  try {
    const parsed = nameRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    const { kind, name, note } = parsed.data;
    if (kind === "LOCATION" && name.length > 100) return res.status(400).json({ message: "A location name can be up to 100 letters." });
    const user = req.user!;
    const details = requestDetailsSchema.safeParse(parsed.data.details ?? {});
    if (!details.success) return badInput(res, details.error);

    const match = matchOf(await loadEntries(prisma, kind), name);
    // An archived name may be asked for: approving it brings it back.
    if (match?.is_active) {
      return res.status(409).json({ message: `"${match.name}" is already in the list. Pick that one.`, existing: match.name });
    }
    const pending = await prisma.masterNameRequest.findMany({ where: { kind, status: "PENDING" }, include: requestInclude });
    const asked = pending.find((p) => nameKey(p.name) === nameKey(name));
    if (asked) {
      return res.status(409).json({
        message: `"${asked.name}" has already been asked for. The admin will add it soon.`,
        existing_request: asked,
      });
    }

    const request = await prisma.masterNameRequest.create({
      data: {
        kind,
        name,
        note: note ?? null,
        requested_by: user.id,
        details: Object.keys(details.data).length ? (details.data as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      include: requestInclude,
    });
    await notifyNameRequested(KIND_LABELS[kind], name, user.name).catch((e) => console.error("Name request notification failed:", e));
    return res.status(201).json({ request });
  } catch (err) {
    return fail(res, err);
  }
};

/** GET /api/master-library/requests ?status=PENDING|APPROVED|REJECTED — the Admin sees all, anyone else their own. */
export const listNameRequests = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const status = String(req.query.status ?? "");
    const where: Prisma.MasterNameRequestWhereInput = {
      ...(user.role === "ADMIN" ? {} : { requested_by: user.id }),
      ...(["PENDING", "APPROVED", "REJECTED"].includes(status) ? { status: status as "PENDING" } : {}),
    };
    const [requests, pending] = await Promise.all([
      prisma.masterNameRequest.findMany({ where, include: requestInclude, orderBy: { created_at: "desc" }, take: 300 }),
      prisma.masterNameRequest.count({ where: { ...where, status: "PENDING" } }),
    ]);
    return res.status(200).json({ requests, pending });
  } catch (err) {
    return fail(res, err);
  }
};

async function pendingRequest(tx: Db, id: number) {
  const request = await tx.masterNameRequest.findUnique({ where: { id } });
  if (!request) throw new HttpError(404, "Request not found.");
  if (request.status !== "PENDING") throw new HttpError(409, "This request was already decided.");
  return request;
}

/**
 * POST /api/master-library/requests/:id/approve {name?, code?, locality?, district?} — adds the
 * name (the admin may correct the spelling). If the name is already in the list, nothing new is
 * added: an archived one is brought back.
 */
export const approveNameRequest = async (req: Request, res: Response) => {
  try {
    const id = idOf(req);
    const parsed = approveRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badInput(res, parsed.error);
    const d = parsed.data;
    const user = req.user!;

    const result = await withAudit(user.id, async (tx) => {
      const request = await pendingRequest(tx, id);
      const kind = request.kind as MasterKind;
      const name = d.name ?? cleanName(request.name);
      if (kind === "LOCATION" && name.length > 100) throw new HttpError(400, "A location name can be up to 100 letters.");

      const match = matchOf(await loadEntries(tx, kind), name);
      let entry: Entry;
      if (match) {
        entry = match.is_active ? match : await restore(tx, kind, match.id);
        if (!match.is_active && kind !== "LOCATION") {
          await audit(tx, user, kind, match.id, "UPDATE", { is_active: false }, { is_active: true, via: "name request" });
        }
      } else {
        if (kind === "CLIENT") await assertCodeFree(tx, d.code);
        // What the CSM filled in, with the admin's corrections on top.
        const asked = requestDetailsSchema.safeParse(request.details ?? {});
        const base = asked.success ? asked.data : {};
        const pick = <K extends keyof typeof d>(k: K) => (d[k] !== undefined ? d[k] : (base as Record<string, unknown>)[k as string]);
        entry = await createEntry(tx, kind, {
          name,
          code: d.code,
          locality: pick("locality") as Locality | undefined,
          district: pick("district") as string | null | undefined,
          state: pick("state") as string | null | undefined,
          default_machine_id: pick("machine_id") as number | null | undefined,
          short_name: pick("short_name") as string | null | undefined,
          contact_person: pick("contact_person") as string | null | undefined,
          contact_number: pick("contact_number") as string | null | undefined,
          email: pick("email") as string | null | undefined,
          csm_name: pick("csm_name") as string | null | undefined,
        });
        await audit(tx, user, kind, entry.id, "INSERT", null, { name: entry.name, via: "name request", request_id: request.id });
      }
      const updated = await tx.masterNameRequest.update({
        where: { id },
        data: { status: "APPROVED", decided_by: user.id, decided_at: new Date(), final_name: entry.name },
        include: requestInclude,
      });
      return { request: updated, entry, existed: !!match };
    });

    // A new client with an email address gets the welcome email.
    if (!result.existed && result.request.kind === "CLIENT" && (result.entry as { email?: string | null }).email) {
      const c = result.entry as { name: string; code?: string | null; email?: string | null; contact_person?: string | null };
      sendClientWelcomeEmail(c.email!, c.name, c.contact_person ?? null, c.code ?? null).catch((e) => console.error("Welcome email failed:", e));
    }
    if (result.request.requested_by) {
      await notifyNameRequestDecided(result.request.requested_by, {
        approved: true,
        kindLabel: KIND_LABELS[result.request.kind as MasterKind],
        asked: result.request.name,
        added: result.entry.name,
      }).catch((e) => console.error("Name request notification failed:", e));
    }
    return res.status(200).json(result);
  } catch (err) {
    return fail(res, err);
  }
};

async function restore(tx: Db, kind: MasterKind, id: number): Promise<Entry> {
  if (kind === "CLIENT") {
    return tx.client.update({ where: { id }, data: { is_active: true }, select: CLIENT_SELECT });
  }
  if (kind === "MEDIA") {
    return tx.media.update({ where: { id }, data: { is_active: true }, select: MEDIA_SELECT });
  }
  return tx.area.update({
    where: { id },
    data: { is_active: true },
    select: AREA_SELECT,
  });
}

/** POST /api/master-library/requests/:id/reject {reason} */
export const rejectNameRequest = async (req: Request, res: Response) => {
  try {
    const id = idOf(req);
    const parsed = rejectRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    const user = req.user!;

    const request = await prisma.$transaction(async (tx) => {
      await pendingRequest(tx, id);
      return tx.masterNameRequest.update({
        where: { id },
        data: { status: "REJECTED", decided_by: user.id, decided_at: new Date(), reject_reason: parsed.data.reason },
        include: requestInclude,
      });
    });
    if (request.requested_by) {
      await notifyNameRequestDecided(request.requested_by, {
        approved: false,
        kindLabel: KIND_LABELS[request.kind as MasterKind],
        asked: request.name,
        reason: parsed.data.reason,
      }).catch((e) => console.error("Name request notification failed:", e));
    }
    return res.status(200).json({ request });
  } catch (err) {
    return fail(res, err);
  }
};
