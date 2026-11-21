import { Request, Response } from "express";
import * as xlsx from "xlsx";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { notifyRole, notifyUser } from "../services/notifications.service";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { serializeDecimals } from "../utils/serialize";
import { todayIST } from "../utils/work-allocation";
import { cardRatesFor, dayOf } from "../utils/rate-card";

/**
 * Rate cards per client and line item. The admin's entries go live at once; a CSM's wait for
 * approval. Excel download and upload per client (upload is the admin's).
 */

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-22.")
  .optional();

const createSchema = z.object({
  client_name: z.string().trim().min(1, "Pick the client."),
  media: z.string().trim().min(1, "Pick the line item."),
  rate: z.coerce.number().positive("The rate must be more than zero.").max(10_000_000),
  effective_from: isoDay,
  note: z.string().trim().max(500).optional().nullable(),
});

const updateSchema = z.object({
  rate: z.coerce.number().positive().max(10_000_000).optional(),
  effective_from: isoDay,
  note: z.string().trim().max(500).optional().nullable(),
});

const decideSchema = z.object({
  rate: z.coerce.number().positive().max(10_000_000).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

const include = {
  client: { select: { id: true, name: true, code: true } },
  media: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  decider: { select: { id: true, name: true } },
} as const;

const out = (r: any, currentIds?: Set<number>) =>
  serializeDecimals({
    id: r.id,
    client: r.client,
    media: r.media,
    rate: r.rate,
    effective_from: r.effective_from.toISOString().slice(0, 10),
    status: r.status,
    note: r.note,
    creator: r.creator,
    decider: r.decider,
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    created_at: r.created_at,
    in_force: currentIds ? currentIds.has(r.id) : undefined,
  });

async function findNames(clientName: string, media: string) {
  const [client, item] = await Promise.all([
    prisma.client.findFirst({ where: { name: { equals: clientName, mode: "insensitive" }, is_active: true } }),
    prisma.media.findFirst({ where: { name: { equals: media, mode: "insensitive" }, is_active: true } }),
  ]);
  return { client, item };
}

/** The ids of the entries in force today, one per client and line item. */
async function inForceIds(clientIds?: number[]) {
  const rows = await prisma.rateCard.findMany({
    where: { status: "ACTIVE", effective_from: { lte: dayOf(todayIST()) }, ...(clientIds ? { client_id: { in: clientIds } } : {}) },
    orderBy: [{ effective_from: "desc" }, { id: "desc" }],
    select: { id: true, client_id: true, media_id: true },
  });
  const seen = new Set<string>();
  const ids = new Set<number>();
  for (const r of rows) {
    const k = `${r.client_id}:${r.media_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ids.add(r.id);
  }
  return ids;
}

/** GET /api/rate-cards?client=&status= — every entry, newest first, with the one in force marked. */
export const listRateCards = async (req: Request, res: Response) => {
  try {
    const client = typeof req.query.client === "string" ? req.query.client.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
    const rows = await prisma.rateCard.findMany({
      where: {
        ...(client ? { client: { name: { equals: client, mode: "insensitive" } } } : {}),
        ...(status === "PENDING" || status === "ACTIVE" || status === "REJECTED" ? { status } : {}),
      },
      include,
      orderBy: [{ client: { name: "asc" } }, { media: { name: "asc" } }, { effective_from: "desc" }, { id: "desc" }],
      take: 3000,
    });
    const current = await inForceIds();
    return res.json({ rates: rows.map((r) => out(r, current)) });
  } catch (err) {
    console.error("listRateCards", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/rate-cards/count — rate cards waiting for the admin. */
export const rateCardCount = async (_req: Request, res: Response) => {
  try {
    return res.json({ pending: await prisma.rateCard.count({ where: { status: "PENDING" } }) });
  } catch (err) {
    console.error("rateCardCount", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /api/rate-cards/lookup?client=&date= — the rates an order line takes, by line item. */
export const lookupRates = async (req: Request, res: Response) => {
  try {
    const client = typeof req.query.client === "string" ? req.query.client.trim() : "";
    if (!client) return res.json({ rates: [] });
    const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : todayIST();
    const rates = await cardRatesFor(client, date);
    return res.json({
      rates: [...rates.values()].map((r) => ({ media: r.media, rate: r.rate, effective_from: r.effective_from.toISOString().slice(0, 10) })),
    });
  } catch (err) {
    console.error("lookupRates", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/rate-cards — live at once for the admin; a CSM's waits for approval. */
export const createRateCard = async (req: Request, res: Response) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const user = req.user!;
    const isAdmin = user.role === "ADMIN";
    const { client, item } = await findNames(parsed.data.client_name, parsed.data.media);
    if (!client) return res.status(400).json({ message: `${parsed.data.client_name} is not an active client in the Master Library.` });
    if (!item) return res.status(400).json({ message: `${parsed.data.media} is not an active line item in the Master Library.` });
    const from = parsed.data.effective_from ?? todayIST();
    if (!isAdmin) {
      const waiting = await prisma.rateCard.findFirst({ where: { client_id: client.id, media_id: item.id, status: "PENDING" } });
      if (waiting) return res.status(409).json({ message: `A rate for ${item.name} at ${client.name} is already waiting for the admin.` });
    }
    const created = await prisma.rateCard.create({
      data: {
        client_id: client.id,
        media_id: item.id,
        rate: parsed.data.rate,
        effective_from: dayOf(from),
        note: parsed.data.note || null,
        status: isAdmin ? "ACTIVE" : "PENDING",
        created_by: user.id,
        ...(isAdmin ? { decided_by: user.id, decided_at: new Date() } : {}),
      },
      include,
    });
    if (!isAdmin) {
      await notifyRole(
        "ADMIN",
        "Rate card asked",
        `${user.name} asked for ${item.name} at ${client.name}: ₹${parsed.data.rate} from ${from}.`,
        "info",
        null,
        "/admin/rate-cards",
      ).catch(() => {});
    }
    return res.status(201).json({ rate: out(created) });
  } catch (err) {
    console.error("createRateCard", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** PATCH /api/rate-cards/:id — admin edits the figure, date or note. */
export const updateRateCard = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
    const found = await prisma.rateCard.findUnique({ where: { id } });
    if (!found) return res.status(404).json({ message: "Rate card entry not found." });
    const updated = await prisma.rateCard.update({
      where: { id },
      data: {
        ...(parsed.data.rate !== undefined ? { rate: parsed.data.rate } : {}),
        ...(parsed.data.effective_from ? { effective_from: dayOf(parsed.data.effective_from) } : {}),
        ...(parsed.data.note !== undefined ? { note: parsed.data.note || null } : {}),
      },
      include,
    });
    return res.json({ rate: out(updated) });
  } catch (err) {
    console.error("updateRateCard", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** DELETE /api/rate-cards/:id — admin. Lines already priced keep their rate. */
export const deleteRateCard = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const found = await prisma.rateCard.findUnique({ where: { id } });
    if (!found) return res.status(404).json({ message: "Rate card entry not found." });
    await prisma.rateCard.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteRateCard", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/rate-cards/:id/approve — the admin may change the figure first. */
export const approveRateCard = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = decideSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid input" });
    const claimed = await prisma.rateCard.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "ACTIVE",
        decided_by: req.user!.id,
        decided_at: new Date(),
        decision_note: parsed.data.note || null,
        ...(parsed.data.rate ? { rate: parsed.data.rate } : {}),
      },
    });
    if (claimed.count === 0) return res.status(409).json({ message: "This rate is no longer waiting." });
    const r = await prisma.rateCard.findUniqueOrThrow({ where: { id }, include });
    if (r.created_by) {
      await notifyUser(r.created_by, "Rate card approved", `${r.media.name} at ${r.client.name}: ₹${Number(r.rate)} from ${out(r).effective_from}.`, "success", null, "/employee/rate-cards").catch(() => {});
    }
    return res.json({ rate: out(r) });
  } catch (err) {
    console.error("approveRateCard", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** POST /api/rate-cards/:id/reject — a note is required. */
export const rejectRateCard = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (note.length < 3) return res.status(400).json({ message: "Say why the rate is rejected." });
    const claimed = await prisma.rateCard.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", decided_by: req.user!.id, decided_at: new Date(), decision_note: note },
    });
    if (claimed.count === 0) return res.status(409).json({ message: "This rate is no longer waiting." });
    const r = await prisma.rateCard.findUniqueOrThrow({ where: { id }, include });
    if (r.created_by) {
      await notifyUser(r.created_by, "Rate card rejected", `${r.media.name} at ${r.client.name}: ${note}`, "warning", null, "/employee/rate-cards").catch(() => {});
    }
    return res.json({ rate: out(r) });
  } catch (err) {
    console.error("rejectRateCard", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// --- Excel -----------------------------------------------------------------

const HEADERS = ["Client", "Line item", "Rate", "Effective from"];
const EXAMPLE = "Example:";

function sendBook(res: Response, rows: (string | number)[][], filename: string) {
  const wb = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 36 }, { wch: 36 }, { wch: 10 }, { wch: 14 }];
  xlsx.utils.book_append_sheet(wb, sheet, "Rate Card");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return res.send(xlsx.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/** GET /api/rate-cards/template — headings and one example row (skipped on upload). */
export const rateCardTemplate = async (_req: Request, res: Response) =>
  sendBook(res, [HEADERS, [`${EXAMPLE} Client name`, "Line item name", 12.5, todayIST()]], "Rate_Card_Template.xlsx");

/** GET /api/rate-cards/export?client= — the rates in force today (all clients, or one). */
export const exportRateCards = async (req: Request, res: Response) => {
  try {
    const client = typeof req.query.client === "string" ? req.query.client.trim() : "";
    const ids = await inForceIds();
    const rows = await prisma.rateCard.findMany({
      where: { id: { in: [...ids] }, ...(client ? { client: { name: { equals: client, mode: "insensitive" } } } : {}) },
      include,
      orderBy: [{ client: { name: "asc" } }, { media: { name: "asc" } }],
    });
    const body = rows.map((r) => [r.client.name, r.media.name, Number(r.rate), r.effective_from.toISOString().slice(0, 10)]);
    const safe = client ? client.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40) : "All_Clients";
    return sendBook(res, [HEADERS, ...body], `Rate_Card_${safe}.xlsx`);
  } catch (err) {
    console.error("exportRateCards", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** An Excel date cell (serial number or text) as YYYY-MM-DD, or null when it can't be read. */
function cellDay(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return todayIST();
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

/**
 * POST /api/rate-cards/import[?preview=1] — the admin's sheet. Each row adds an entry, or
 * changes the rate of the entry with the same client, line item and date. Nothing is deleted.
 */
export const importRateCards = async (req: Request, res: Response) => {
  try {
    const buf = req.body;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ message: "No file received." });
    let rows: unknown[][];
    try {
      const wb = xlsx.read(buf, { type: "buffer" });
      const first = wb.Sheets[wb.SheetNames[0]!];
      rows = first ? (xlsx.utils.sheet_to_json(first, { header: 1, blankrows: false, defval: "" }) as unknown[][]) : [];
    } catch {
      return res.status(400).json({ message: "Could not read that file. Upload the .xlsx rate card sheet." });
    }
    if (rows.length > 5001) return res.status(400).json({ message: "Up to 5,000 rows at a time." });
    const head = (rows[0] ?? []).map((h) => String(h).trim().toLowerCase());
    const col = (names: string[]) => head.findIndex((h) => names.includes(h));
    const cClient = col(["client", "client name"]);
    const cMedia = col(["line item", "line items", "media", "item"]);
    const cRate = col(["rate", "rate (₹)"]);
    const cFrom = col(["effective from", "from", "date"]);
    if (cClient < 0 || cMedia < 0 || cRate < 0) {
      return res.status(400).json({ message: "The first row must have the headings Client, Line item and Rate." });
    }
    const [clients, media] = await Promise.all([
      prisma.client.findMany({ where: { is_active: true }, select: { id: true, name: true } }),
      prisma.media.findMany({ where: { is_active: true }, select: { id: true, name: true } }),
    ]);
    const clientBy = new Map(clients.map((c) => [c.name.toLowerCase(), c]));
    const mediaBy = new Map(media.map((m) => [m.name.toLowerCase(), m]));

    const good: { row: number; client_id: number; media_id: number; rate: number; from: string; client: string; media: string }[] = [];
    const errors: { row: number; message: string }[] = [];
    rows.slice(1).forEach((r, i) => {
      const row = i + 2;
      const cName = String(r[cClient] ?? "").trim();
      const mName = String(r[cMedia] ?? "").trim();
      if (!cName && !mName) return;
      if (cName.toLowerCase().startsWith(EXAMPLE.toLowerCase())) return;
      const c = clientBy.get(cName.toLowerCase());
      const m = mediaBy.get(mName.toLowerCase());
      const rate = Number(String(r[cRate] ?? "").replace(/[₹,\s]/g, ""));
      const from = cFrom >= 0 ? cellDay(r[cFrom]) : todayIST();
      if (!c) return void errors.push({ row, message: `Client "${cName}" is not in the Master Library.` });
      if (!m) return void errors.push({ row, message: `Line item "${mName}" is not in the Master Library.` });
      if (!(rate > 0)) return void errors.push({ row, message: "Rate must be a number more than zero." });
      if (!from) return void errors.push({ row, message: "Effective from must be a date like 2026-11-22." });
      good.push({ row, client_id: c.id, media_id: m.id, rate: Number(rate.toFixed(2)), from, client: c.name, media: m.name });
    });

    const preview = req.query.preview === "1" || req.query.preview === "true";
    let added = 0;
    let updated = 0;
    if (!preview) {
      const userId = req.user!.id;
      await prisma.$transaction(
        async (tx) => {
          for (const g of good) {
            const same = await tx.rateCard.findFirst({
              where: { client_id: g.client_id, media_id: g.media_id, effective_from: dayOf(g.from), status: "ACTIVE" },
            });
            if (same) {
              if (Number(same.rate) !== g.rate) {
                await tx.rateCard.update({ where: { id: same.id }, data: { rate: g.rate } });
                updated++;
              }
            } else {
              await tx.rateCard.create({
                data: {
                  client_id: g.client_id,
                  media_id: g.media_id,
                  rate: g.rate,
                  effective_from: dayOf(g.from),
                  status: "ACTIVE",
                  created_by: userId,
                  decided_by: userId,
                  decided_at: new Date(),
                  note: "Uploaded",
                },
              });
              added++;
            }
          }
        },
        { timeout: 120000 },
      );
    }
    return res.json({
      applied: !preview,
      rows: good.slice(0, 300).map(({ row, client, media, rate, from }) => ({ row, client, media, rate, effective_from: from })),
      row_count: good.length,
      errors: errors.slice(0, 200),
      error_count: errors.length,
      added,
      updated,
    });
  } catch (err) {
    console.error("importRateCards", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
