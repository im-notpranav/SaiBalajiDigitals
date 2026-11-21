import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { notifyRole, notifyUser } from "../services/notifications.service";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { checkMasterNames, missingNamesBody } from "../utils/lookups";
import { recomputeOrderStatus } from "../utils/order-derive";
import { serializeDecimals } from "../utils/serialize";
import { invokeHandler } from "../utils/invoke-handler";
import { approveRateChange, rejectRateChange as rejectRateCardChange } from "../utils/rate-card";
import { addStore, updateOrder, updateOrderDetails, updateStore } from "./orders.controller";

/* ------------------------------------------------------------------ input shapes */

const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const num = (v: unknown) => Number(v);
const sftOf = (w: number, h: number, q: number) => Number((((w * h) / 144) * q).toFixed(2));
const amountOf = (w: number, h: number, q: number, r: number) => Number((sftOf(w, h, q) * r).toFixed(2));

const lineShape = z.object({
  id: z.number().int().positive().optional(),
  store_id: z.number().int().positive().optional(),
  media: z.string().trim().min(1).max(200),
  width_inches: z.coerce.number().positive(),
  height_inches: z.coerce.number().positive(),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().positive(),
});

/** An essential edit, as the CSM's edit form produced it. Only what changes is sent. */
export const lineEditPayloadSchema = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  stores: z
    .array(
      z.object({
        id: z.number().int().positive(),
        store_name: z.string().trim().min(1).max(100).optional(),
        location: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .max(50)
    .optional(),
  new_stores: z
    .array(
      z.object({
        store_name: z.string().trim().min(1).max(100),
        location: z.string().trim().min(1).max(100),
        po_number: z.string().max(50).optional().nullable(),
        items: z.array(lineShape.omit({ id: true, store_id: true })).min(1).max(500),
      }),
    )
    .max(50)
    .optional(),
  items: z.array(lineShape).max(500).optional(),
  remove_item_ids: z.array(z.number().int().positive()).max(500).optional(),
});
export type LineEditPayload = z.infer<typeof lineEditPayloadSchema>;

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LINE_EDIT"), reason: z.string().trim().min(3, "Give a reason.").max(1000), payload: lineEditPayloadSchema }),
  z.object({ kind: z.literal("COMBINE_ORDERS"), reason: z.string().trim().min(3, "Give a reason.").max(1000), other_order_id: z.number().int().positive() }),
  z.object({ kind: z.literal("OTHER"), reason: z.string().trim().min(3, "Say what you need.").max(1000) }),
]);

const decideSchema = z.object({ note: z.string().trim().max(500).optional().nullable() });
const rejectSchema = z.object({ note: z.string().trim().min(3, "Say why you are rejecting it.").max(500) });

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export const fail = (res: Response, err: unknown, where: string) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...(err.extra ?? {}) });
  console.error(`${where} error:`, err);
  return res.status(500).json({ message: "Something went wrong. Please try again." });
};

export const KIND_LABEL: Record<string, string> = {
  LINE_EDIT: "Order change",
  COMBINE_ORDERS: "Combine orders",
  RATE_CHANGE: "Rate change",
  OTHER: "Other request",
};

/* ------------------------------------------------------------------ helpers */

const orderForRequest = (id: number) =>
  prisma.order.findUnique({
    where: { id },
    include: {
      stores: { orderBy: { s_no: "asc" } },
      items: { include: { assignments: { select: { id: true, completed: true } } }, orderBy: [{ order_store_id: "asc" }, { s_no: "asc" }] },
      invoices: { select: { id: true } },
    },
  });
type OrderForRequest = NonNullable<Awaited<ReturnType<typeof orderForRequest>>>;

const storeTag = (order: OrderForRequest, id: number) => {
  const s = order.stores.find((x) => x.id === id);
  return s ? `S${String(s.s_no).padStart(2, "0")} ${s.store_name}` : `store #${id}`;
};

/** Plain-language lines describing an essential edit against the order as it is now. */
export function describeLineEdit(order: OrderForRequest, p: LineEditPayload): string[] {
  const out: string[] = [];
  if (p.client_name && p.client_name !== order.client_name) out.push(`Client: ${order.client_name} → ${p.client_name}`);
  for (const s of p.stores ?? []) {
    const cur = order.stores.find((x) => x.id === s.id);
    if (!cur) continue;
    if (s.store_name && s.store_name !== cur.store_name) out.push(`${storeTag(order, cur.id)}: name → ${s.store_name}`);
    if (s.location && s.location !== cur.location) out.push(`${storeTag(order, cur.id)}: location ${cur.location} → ${s.location}`);
  }
  for (const it of p.items ?? []) {
    if (it.id) {
      const cur = order.items.find((x) => x.id === it.id);
      if (!cur) continue;
      const bits: string[] = [];
      if (it.media !== cur.media) bits.push(`item ${cur.media} → ${it.media}`);
      if (num(it.width_inches) !== num(cur.width_inches) || num(it.height_inches) !== num(cur.height_inches)) {
        bits.push(`size ${num(cur.width_inches)}×${num(cur.height_inches)} → ${it.width_inches}×${it.height_inches}`);
      }
      if (num(it.qty) !== num(cur.qty)) bits.push(`qty ${num(cur.qty)} → ${it.qty}`);
      if (num(it.rate) !== num(cur.rate)) bits.push(`rate ${money(num(cur.rate))} → ${money(it.rate)}`);
      const newAmt = amountOf(it.width_inches, it.height_inches, it.qty, it.rate);
      if (bits.length) out.push(`${storeTag(order, cur.order_store_id)} line ${cur.s_no} (${cur.media}): ${bits.join(", ")} · ${money(num(cur.amount))} → ${money(newAmt)}`);
    } else {
      const storeId = it.store_id ?? order.stores[0]?.id;
      out.push(
        `New line on ${storeId ? storeTag(order, storeId) : "the order"}: ${it.media} ${it.width_inches}×${it.height_inches} × ${it.qty} @ ${money(it.rate)} = ${money(amountOf(it.width_inches, it.height_inches, it.qty, it.rate))}`,
      );
    }
  }
  for (const id of p.remove_item_ids ?? []) {
    const cur = order.items.find((x) => x.id === id);
    if (cur) out.push(`Remove ${storeTag(order, cur.order_store_id)} line ${cur.s_no} (${cur.media}, ${money(num(cur.amount))})`);
  }
  for (const s of p.new_stores ?? []) {
    const total = s.items.reduce((sum, i) => sum + amountOf(i.width_inches, i.height_inches, i.qty, i.rate), 0);
    out.push(`New store: ${s.store_name} (${s.location}) with ${s.items.length} line${s.items.length === 1 ? "" : "s"}, ${money(total)}`);
  }
  return out;
}

/** Checks a line edit can still be applied, and that every name is in the Master Library. */
async function checkLineEdit(order: OrderForRequest, p: LineEditPayload) {
  const itemIds = new Set(order.items.map((i) => i.id));
  const storeIds = new Set(order.stores.map((s) => s.id));
  for (const it of p.items ?? []) {
    if (it.id && !itemIds.has(it.id)) throw new HttpError(400, `Line ${it.id} is not on this order.`);
    if (it.store_id && !storeIds.has(it.store_id)) throw new HttpError(400, `Store ${it.store_id} is not on this order.`);
  }
  for (const s of p.stores ?? []) if (!storeIds.has(s.id)) throw new HttpError(400, `Store ${s.id} is not on this order.`);
  for (const id of p.remove_item_ids ?? []) {
    const cur = order.items.find((i) => i.id === id);
    if (!cur) throw new HttpError(400, `Line ${id} is not on this order.`);
    if (cur.production_completed) throw new HttpError(409, `Line ${cur.s_no} (${cur.media}) is already produced and cannot be removed.`);
    const store = order.stores.find((s) => s.id === cur.order_store_id);
    if (store?.invoice_id) throw new HttpError(409, `Line ${cur.s_no} (${cur.media}) is already invoiced and cannot be removed.`);
  }
  const names = [
    ...(p.client_name && p.client_name !== order.client_name ? [{ kind: "CLIENT" as const, name: p.client_name }] : []),
    ...(p.stores ?? []).filter((s) => s.location).map((s) => ({ kind: "LOCATION" as const, name: s.location! })),
    ...(p.new_stores ?? []).map((s) => ({ kind: "LOCATION" as const, name: s.location })),
    ...(p.items ?? [])
      .filter((i) => !i.id || order.items.find((x) => x.id === i.id)?.media !== i.media)
      .map((i) => ({ kind: "MEDIA" as const, name: i.media })),
    ...(p.new_stores ?? []).flatMap((s) => s.items.map((i) => ({ kind: "MEDIA" as const, name: i.media }))),
  ];
  const checked = await checkMasterNames(prisma, names);
  if (checked.missing.length) throw new HttpError(400, "Some names are not in the Master Library.", missingNamesBody(checked.missing));
}

const requestInclude = {
  requester: { select: { id: true, name: true } },
  decider: { select: { id: true, name: true } },
  order: { select: { id: true, order_no: true, client_name: true, created_by: true, creator_name: true, status: true } },
} as const;

/* ------------------------------------------------------------------ CSM side */

/** POST /api/orders/:id/change-requests — the CSM asks for an essential change, a combine, or anything else. */
export const createChangeRequest = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request.", errors: sanitizeZodErrors(parsed.error) });
    }
    const input = parsed.data;
    const user = req.user!;
    const order = await orderForRequest(orderId);
    if (!order) throw new HttpError(404, "Order not found");
    if (order.status === "Completed") throw new HttpError(409, "This order is closed.");
    if (user.role === "CSM" && order.created_by !== user.id) throw new HttpError(403, "Only the order's CSM can request changes on it.");

    let summary: string;
    let payload: LineEditPayload | null = null;
    let otherOrderId: number | null = null;

    if (input.kind === "LINE_EDIT") {
      await checkLineEdit(order, input.payload);
      const lines = describeLineEdit(order, input.payload);
      if (lines.length === 0) throw new HttpError(400, "Nothing would change.");
      summary = lines.join("\n");
      payload = input.payload;
    } else if (input.kind === "COMBINE_ORDERS") {
      const other = await orderForRequest(input.other_order_id);
      if (!other || other.id === order.id) throw new HttpError(400, "Pick another order to combine.");
      checkCombinable(order, other);
      summary = `Combine ${other.order_no} into ${order.order_no}: its ${other.stores.length} store${other.stores.length === 1 ? "" : "s"} and ${other.items.length} line${other.items.length === 1 ? "" : "s"} move here; ${other.order_no} closes as merged.`;
      otherOrderId = other.id;
    } else {
      summary = input.reason;
    }

    const created = await prisma.changeRequest.create({
      data: {
        order_id: order.id,
        kind: input.kind,
        reason: input.reason,
        summary,
        payload: payload ?? undefined,
        other_order_id: otherOrderId,
        requested_by: user.id,
      },
      include: requestInclude,
    });
    await notifyRole("ADMIN", `${KIND_LABEL[input.kind]} requested on ${order.order_no}`, `${user.name}: ${input.reason.slice(0, 140)}`, "warning", order.id).catch(() => {});
    return res.status(201).json({ request: serializeDecimals(created) });
  } catch (err) {
    return fail(res, err, "createChangeRequest");
  }
};

function checkCombinable(target: OrderForRequest, other: OrderForRequest) {
  if (other.client_name !== target.client_name) {
    throw new HttpError(409, `${other.order_no} is for ${other.client_name}, not ${target.client_name}. Only orders of the same client can be combined.`);
  }
  if (other.status === "Completed" || target.status === "Completed") throw new HttpError(409, "Closed orders cannot be combined.");
  if (other.merged_into_id) throw new HttpError(409, `${other.order_no} was already merged into ${other.merged_into_no}.`);
  if (other.invoices.length || target.invoices.length) throw new HttpError(409, "An order with an invoice cannot be combined.");
  if (target.stores.length + other.stores.length > 50) throw new HttpError(409, "Together the orders would have more than 50 stores.");
}

/** GET /api/orders/:id/change-requests — every request on the order, newest first. */
export const listOrderChangeRequests = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);
    const requests = await prisma.changeRequest.findMany({ where: { order_id: orderId }, include: requestInclude, orderBy: { created_at: "desc" } });
    return res.json({ requests: serializeDecimals(requests) });
  } catch (err) {
    return fail(res, err, "listOrderChangeRequests");
  }
};

/** GET /api/orders/:id/combine-options — open, uninvoiced orders of the same client. */
export const combineOptions = async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { client_name: true } });
    if (!order) throw new HttpError(404, "Order not found");
    const orders = await prisma.order.findMany({
      where: { id: { not: orderId }, client_name: order.client_name, status: { not: "Completed" }, merged_into_id: null, invoices: { none: {} } },
      select: { id: true, order_no: true, date: true, creator_name: true, _count: { select: { stores: true, items: true } } },
      orderBy: { id: "desc" },
      take: 100,
    });
    return res.json({ orders });
  } catch (err) {
    return fail(res, err, "combineOptions");
  }
};

/** POST /api/change-requests/:id/cancel — the requester withdraws a pending request. */
export const cancelChangeRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.changeRequest.findUnique({ where: { id } });
    if (!cr) throw new HttpError(404, "Request not found");
    if (cr.requested_by !== req.user!.id && req.user!.role !== "ADMIN") throw new HttpError(403, "Only whoever asked can withdraw it.");
    if (cr.status !== "PENDING") throw new HttpError(409, "This request is already decided.");
    const updated = await prisma.changeRequest.update({ where: { id }, data: { status: "CANCELLED", decided_at: new Date() }, include: requestInclude });
    if (cr.kind === "RATE_CHANGE") await rejectRateChange(cr.payload as any);
    return res.json({ request: serializeDecimals(updated) });
  } catch (err) {
    return fail(res, err, "cancelChangeRequest");
  }
};

/* ------------------------------------------------------------------ admin queue */

function remarkLabel(r: string) {
  return ({ UnderWarranty: "Under Warranty", FreeOfCost: "Free of Cost", ExtraAmount: "Extra Amount", LessAmount: "Less Amount" } as Record<string, string>)[r] ?? r;
}

const sNo = (n: number) => `S${String(n).padStart(2, "0")}`;

/**
 * GET /api/change-requests?status=pending|decided — one queue for everything a CSM asked:
 * change requests, whole-order Extra / Less Amounts, and line remarks (Reprint, Sample,
 * Under Warranty, Free of Cost, Other) waiting for confirmation.
 */
export const changeRequestQueue = async (req: Request, res: Response) => {
  try {
    const decided = String(req.query.status ?? "pending") === "decided";
    const orderSel = { select: { id: true, order_no: true, client_name: true, created_by: true, creator_name: true } };
    const [changes, adjustments, lines] = await Promise.all([
      prisma.changeRequest.findMany({
        where: decided ? { status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } } : { status: "PENDING" },
        include: requestInclude,
        orderBy: { created_at: decided ? "desc" : "asc" },
        take: decided ? 100 : 500,
      }),
      prisma.orderAdjustment.findMany({
        where: decided ? { status: { in: ["Approved", "Rejected"] }, requested_by: { not: null } } : { status: "Requested" },
        include: {
          order: orderSel,
          orderStore: { select: { s_no: true, store_name: true } },
          requester: { select: { id: true, name: true } },
          decider: { select: { id: true, name: true } },
        },
        orderBy: { created_at: decided ? "desc" : "asc" },
        take: decided ? 100 : 500,
      }),
      decided
        ? Promise.resolve([] as any[])
        : prisma.orderItem.findMany({
            where: { remarks: { not: null }, remarks_confirmed: false, order: { status: { not: "Completed" } } },
            include: { order: orderSel, remarksSetter: { select: { id: true, name: true } }, orderStore: { select: { s_no: true, store_name: true } } },
            orderBy: { remarks_set_at: "asc" },
            take: 500,
          }),
    ]);

    const rows = [
      ...changes.map((c) => ({
        source: "change" as const,
        id: c.id,
        kind: c.kind as string,
        label: KIND_LABEL[c.kind] ?? c.kind,
        status: c.status as string,
        order: c.order,
        reason: c.reason,
        summary: c.summary,
        amount: null as number | null,
        store_id: null as number | null,
        requester: c.requester,
        decider: c.decider,
        decision_note: c.decision_note,
        created_at: c.created_at,
        decided_at: c.decided_at,
      })),
      ...adjustments.map((a) => ({
        source: "adjustment" as const,
        id: a.id,
        kind: a.type as string,
        label: a.type === "ExtraAmount" ? "Extra Amount" : "Less Amount",
        status: a.status === "Requested" ? "PENDING" : a.status.toUpperCase(),
        order: a.order,
        reason: a.reason,
        summary: `${a.type === "ExtraAmount" ? "+" : "−"}${money(num(a.amount))} on the order, billed with ${sNo(a.orderStore.s_no)} ${a.orderStore.store_name}`,
        amount: num(a.amount),
        store_id: a.order_store_id,
        requester: a.requester,
        decider: a.decider,
        decision_note: a.decision_note,
        created_at: a.created_at,
        decided_at: a.decided_at,
      })),
      ...(lines as any[]).map((i) => ({
        source: "line_remark" as const,
        id: i.id as number,
        kind: i.remarks as string,
        label: remarkLabel(i.remarks),
        status: "PENDING",
        order: i.order,
        reason: (i.remarks_other_text ?? "") as string,
        summary: `${sNo(i.orderStore.s_no)} line ${i.s_no} (${i.media}, ${money(num(i.amount))}): ${remarkLabel(i.remarks)}${i.adjustment_amount ? ` ${money(num(i.adjustment_amount))}` : ""}`,
        amount: i.adjustment_amount != null ? num(i.adjustment_amount) : null,
        store_id: i.order_store_id as number,
        requester: i.remarksSetter,
        decider: null,
        decision_note: null,
        created_at: i.remarks_set_at ?? new Date(0),
        decided_at: null,
      })),
    ].sort((a, b) => (decided ? -1 : 1) * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));

    return res.json({ requests: serializeDecimals(rows) });
  } catch (err) {
    return fail(res, err, "changeRequestQueue");
  }
};

/** GET /api/change-requests/count — pending total, for the admin menu badge. */
export const changeRequestCount = async (_req: Request, res: Response) => {
  try {
    const [c, a, l] = await Promise.all([
      prisma.changeRequest.count({ where: { status: "PENDING" } }),
      prisma.orderAdjustment.count({ where: { status: "Requested" } }),
      prisma.orderItem.count({ where: { remarks: { not: null }, remarks_confirmed: false, order: { status: { not: "Completed" } } } }),
    ]);
    return res.json({ pending: c + a + l });
  } catch (err) {
    return fail(res, err, "changeRequestCount");
  }
};

/* ------------------------------------------------------------------ decisions */

/** POST /api/change-requests/:id/approve — apply the change as the deciding admin. */
export const approveChangeRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = decideSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    const admin = req.user!;
    const cr = await prisma.changeRequest.findUnique({ where: { id } });
    if (!cr) throw new HttpError(404, "Request not found");
    if (cr.status !== "PENDING") throw new HttpError(409, "This request is already decided.");
    const order = await orderForRequest(cr.order_id);
    if (!order) throw new HttpError(404, "Order not found");

    // Claim it first, so a double click cannot apply the same change twice.
    const claimed = await prisma.changeRequest.updateMany({ where: { id, status: "PENDING", decided_at: null }, data: { decided_by: admin.id, decided_at: new Date() } });
    if (claimed.count === 0) throw new HttpError(409, "This request is already being decided.");
    try {
      if (cr.kind === "LINE_EDIT") {
        const payload = lineEditPayloadSchema.parse(cr.payload);
        await checkLineEdit(order, payload);
        await applyLineEdit(order, payload, admin, cr.reason);
      } else if (cr.kind === "COMBINE_ORDERS") {
        const other = cr.other_order_id ? await orderForRequest(cr.other_order_id) : null;
        if (!other) throw new HttpError(409, "The other order no longer exists.");
        checkCombinable(order, other);
        await combineOrders(order, other, admin, cr.reason);
      } else if (cr.kind === "RATE_CHANGE") {
        await applyRateChange(cr.payload as any, admin);
      }
      // OTHER carries no automatic edit: approving records the decision.
    } catch (applyErr) {
      await prisma.changeRequest.update({ where: { id }, data: { decided_by: null, decided_at: null } });
      throw applyErr;
    }

    const updated = await prisma.changeRequest.update({
      where: { id },
      data: { status: "APPROVED", decided_by: admin.id, decided_at: new Date(), decision_note: parsed.data.note || null },
      include: requestInclude,
    });
    if (cr.requested_by) {
      await notifyUser(cr.requested_by, `${KIND_LABEL[cr.kind]} approved on ${order.order_no}`, parsed.data.note || cr.summary.split("\n")[0]!, "success", order.id).catch(() => {});
    }
    return res.json({ request: serializeDecimals(updated) });
  } catch (err) {
    return fail(res, err, "approveChangeRequest");
  }
};

/** POST /api/change-requests/:id/reject — nothing changes; the CSM is told why. */
export const rejectChangeRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const parsed = rejectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
    const cr = await prisma.changeRequest.findUnique({ where: { id }, include: { order: { select: { order_no: true } } } });
    if (!cr) throw new HttpError(404, "Request not found");
    if (cr.status !== "PENDING") throw new HttpError(409, "This request is already decided.");
    const updated = await prisma.changeRequest.update({
      where: { id },
      data: { status: "REJECTED", decided_by: req.user!.id, decided_at: new Date(), decision_note: parsed.data.note },
      include: requestInclude,
    });
    if (cr.kind === "RATE_CHANGE") await rejectRateChange(cr.payload as any);
    if (cr.requested_by) {
      await notifyUser(cr.requested_by, `${KIND_LABEL[cr.kind]} rejected on ${cr.order.order_no}`, parsed.data.note, "warning", cr.order_id).catch(() => {});
    }
    return res.json({ request: serializeDecimals(updated) });
  } catch (err) {
    return fail(res, err, "rejectChangeRequest");
  }
};

/* ------------------------------------------------------------------ appliers */

type Actor = NonNullable<Request["user"]>;

/** Applies an approved essential edit through the admin's own edit handlers. */
async function applyLineEdit(order: OrderForRequest, p: LineEditPayload, admin: Actor, reason: string) {
  const step = async (label: string, run: Promise<{ status: number; body: any }>) => {
    const r = await run;
    if (r.status >= 400) {
      throw new HttpError(r.status, `${label}: ${r.body?.message ?? "could not be applied"}`, r.body?.missing ? { missing: r.body.missing } : undefined);
    }
    return r.body;
  };
  const params = { id: String(order.id) };

  if (p.client_name && p.client_name !== order.client_name) {
    await step("Client", invokeHandler(updateOrderDetails, admin, { params, body: { client_name: p.client_name } }));
  }
  for (const s of p.stores ?? []) {
    const body: Record<string, string> = {};
    if (s.store_name) body.store_name = s.store_name;
    if (s.location) body.location = s.location;
    if (Object.keys(body).length) {
      await step("Store", invokeHandler(updateStore, admin, { params: { orderId: String(order.id), storeId: String(s.id) }, body }));
    }
  }

  // Removing lines: not produced and not invoiced (checked before).
  if (p.remove_item_ids?.length) {
    const gone = order.items.filter((i) => p.remove_item_ids!.includes(i.id));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${admin.id.toString()}, true)`;
      await tx.orderItem.deleteMany({ where: { id: { in: gone.map((i) => i.id) }, order_id: order.id } });
      await tx.orderChangeLog.createMany({
        data: gone.map((i) => ({
          order_id: order.id,
          changed_by: admin.id,
          field_changed: `Item ${i.s_no} removed`,
          old_value: `${i.media} ${num(i.amount)}`,
          new_value: `— (${reason.slice(0, 200)})`,
        })),
      });
      await recomputeOrderStatus(tx, order.id);
    });
  }

  // Lines: a changed saved line carries "Revised" with the CSM's reason, unless it already has a remark.
  const items: any[] = [];
  for (const it of p.items ?? []) {
    if (it.id) {
      const cur = order.items.find((x) => x.id === it.id)!;
      const keep = !!cur.remarks && cur.remarks !== "Revised";
      items.push({
        id: it.id,
        media: it.media,
        width_inches: it.width_inches,
        height_inches: it.height_inches,
        qty: it.qty,
        rate: it.rate,
        remarks: keep ? cur.remarks : "Revised",
        remarks_other_text: keep ? cur.remarks_other_text : `CSM request: ${reason}`.slice(0, 500),
        adjustment_amount: keep && cur.adjustment_amount != null ? num(cur.adjustment_amount) : null,
      });
    } else {
      items.push({ store_id: it.store_id, media: it.media, width_inches: it.width_inches, height_inches: it.height_inches, qty: it.qty, rate: it.rate });
    }
  }
  for (const s of p.new_stores ?? []) {
    const created = await step(
      "New store",
      invokeHandler(addStore, admin, { params, body: { store_name: s.store_name, location: s.location, po_number: s.po_number ?? null } }),
    );
    for (const it of s.items) items.push({ ...it, store_id: created.id });
  }
  if (items.length) await step("Lines", invokeHandler(updateOrder, admin, { params, body: { items } }));
}

/**
 * Folds `other` into `target`: its stores (with their lines and adjustments), field jobs,
 * payment requests, follow-ups and notes move; `other` closes as merged, its number kept.
 */
async function combineOrders(target: OrderForRequest, other: OrderForRequest, admin: Actor, reason: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${admin.id.toString()}, true)`;
    let next = target.stores.reduce((m, s) => Math.max(m, s.s_no), 0);
    for (const s of other.stores) {
      next += 1;
      await tx.orderStore.update({ where: { id: s.id }, data: { order_id: target.id, s_no: next } });
    }
    await tx.workJob.updateMany({ where: { order_id: other.id }, data: { order_id: target.id } });
    await tx.paymentRequest.updateMany({ where: { order_id: other.id }, data: { order_id: target.id } });
    await tx.orderNote.updateMany({ where: { order_id: other.id }, data: { order_id: target.id } });
    await tx.paymentFollowUp.updateMany({ where: { order_id: other.id }, data: { order_id: target.id } });
    await tx.changeRequest.updateMany({
      where: { order_id: other.id, status: "PENDING" },
      data: { status: "CANCELLED", decided_at: new Date(), decision_note: `Order merged into ${target.order_no}` },
    });
    await tx.order.update({
      where: { id: other.id },
      data: {
        status: "Completed",
        remarks: "Other",
        remarks_other_text: `Merged into ${target.order_no}. ${reason}`.slice(0, 500),
        merged_into_id: target.id,
        merged_into_no: target.order_no,
      },
    });
    await tx.orderChangeLog.createMany({
      data: [
        { order_id: target.id, changed_by: admin.id, field_changed: "Combined", old_value: "—", new_value: `${other.order_no} merged in (${other.stores.length} stores)` },
        { order_id: other.id, changed_by: admin.id, field_changed: "Merged", old_value: other.order_no, new_value: `into ${target.order_no}` },
      ],
    });
    await recomputeOrderStatus(tx, target.id);
  });
}

/* Rate changes: the rate card module moves the lines between the card rate and the asked rate. */
const applyRateChange = (payload: any, admin: Actor) => approveRateChange(payload, admin);
const rejectRateChange = (payload: any) => rejectRateCardChange(payload);
