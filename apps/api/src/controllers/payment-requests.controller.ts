import { Request, Response } from "express";
import { createHash } from "node:crypto";
import { Prisma, type PaymentAttachmentKind, type PaymentRequestStatus, type Role } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { getSetting } from "../utils/app-settings";
import { ownerFor, paymentTimers } from "../utils/payment-timers";
import { queueWhatsApp, queueWhatsAppRole } from "../services/whatsapp/outbox";
import type { WaEvent } from "../services/whatsapp/templates";
import {
  paymentMarkPaidSchema,
  paymentNoteSchema,
  paymentRequestSchema,
  paymentResubmitSchema,
} from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { computeTotals } from "../utils/order-totals";
import {
  LIVE_PAYMENT_STATUSES,
  OPEN_PAYMENT_STATUSES,
  STAGE_REVIEWER,
  STATUS_LABELS,
  availableActions,
  blockedActions,
  checkTransition,
  entryStage,
  formatRupees,
  isMaterialChange,
  isReviewerRole,
  paymentEligibility,
  routeFor,
  type TransitionContext,
  type WorkflowAction,
} from "../utils/payment-workflow";
import {
  ATTACHMENT_KIND_LABELS,
  MAX_FILES_PER_REQUEST,
  MAX_FILE_BYTES,
  MAX_FILE_LABEL,
  attachKindsFor,
  canRemoveFile,
  cleanFileName,
  contentDisposition,
  currentStore,
  detectFileType,
  storeFor,
} from "../utils/payment-files";

/**
 * Payment requests: money the company pays out to a CSM or field staff member by UPI.
 * Every status change goes through checkTransition() in utils/payment-workflow.ts, is
 * guarded against a concurrent change of the same request, and leaves a history row.
 *
 * Who sees what: a requester sees only their own requests; the Admin and the Cost Control
 * Manager see all of them. Notifications carry no order link, because field staff and the
 * Cost Control Manager cannot open orders.
 */

class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

function sendError(res: Response, err: any) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.body });
  console.error(err);
  return res.status(500).json({ message: "Internal server error" });
}

const parseId = (raw: unknown) => {
  const id = parseInt(String(raw), 10);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  return id;
};

function parseBody<T>(schema: { safeParse: (b: unknown) => { success: true; data: T } | { success: false; error: any } }, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, "Invalid input", { errors: sanitizeZodErrors(parsed.error) });
  }
  return parsed.data;
}

async function withAudit<T>(userId: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId.toString()}, true)`;
    return fn(tx);
  });
}

type Db = Prisma.TransactionClient | typeof prisma;
type Actor = { id: number; role: string; name?: string };

/* ------------------------------------------------------------------ shapes */

const requestInclude = {
  order: { select: { id: true, order_no: true, client_name: true, status: true } },
  workJob: { select: { id: true, work_details: true, start_date: true } },
  requester: { select: { id: true, name: true, role: true, phone: true, emp_code: true } },
  payer: { select: { id: true, name: true } },
  closer: { select: { id: true, name: true } },
  // Only the kinds, for the counts and the "bill missing" flag; never the files themselves.
  attachments: { where: { deleted_at: null }, select: { kind: true } },
  // Approvals so far: who may still cancel, and whether a requester's files are frozen.
  events: { where: { action: "APPROVE" }, select: { action: true, from_status: true } },
} satisfies Prisma.PaymentRequestInclude;

type RequestRow = Prisma.PaymentRequestGetPayload<{ include: typeof requestInclude }>;

const eligibilityInclude = {
  items: { select: { production_completed: true, assignments: { select: { id: true } } } },
  stores: { select: { invoice_id: true } },
  invoices: { select: { id: true } },
} satisfies Prisma.OrderInclude;

interface OrderMoney {
  order_value: number;
  requested: number;
  paid: number;
  requests: number;
  over_value: boolean;
}

/** Working days after which a waiting request turns red (Admin → Settings). */
const overdueDays = () => getSetting("payment_overdue_days");

/** True while nobody holds the Cost Control role: the Admin then acts for Cost Control (D-05). */
const noActiveCcm = async (db: Db) =>
  (await db.user.count({ where: { role: "COST_CONTROL_MANAGER", is_active: true } })) === 0;

/** Who decides at this stage now: Cost Control, or the Admin standing in for it. */
async function reviewerRoleFor(db: Db, status: PaymentRequestStatus | null | undefined): Promise<Role | undefined> {
  const role = status ? STAGE_REVIEWER[status] : undefined;
  if (role === "COST_CONTROL_MANAGER" && (await noActiveCcm(db))) return "ADMIN";
  return role;
}

type ApprovalEvent = { action: string; from_status: PaymentRequestStatus | null };
const adminApprovedIn = (events: ApprovalEvent[]) =>
  events.some((e) => e.action === "APPROVE" && e.from_status === "ADMIN_REVIEW");
const approvedOnceIn = (events: ApprovalEvent[]) => events.some((e) => e.action === "APPROVE");

function serializeRequest(r: RequestRow, actor: Actor, money: OrderMoney | undefined, threshold: number, ccmMissing = false) {
  const files: Record<PaymentAttachmentKind, number> = { BILL: 0, PHOTO: 0, RECEIPT: 0 };
  for (const a of r.attachments) files[a.kind]++;
  const timers = paymentTimers(r, files.BILL, threshold);
  const ctx: TransitionContext = { billCount: files.BILL, adminApproved: adminApprovedIn(r.events), noActiveCcm: ccmMissing };
  return {
    id: r.id,
    order: r.order,
    work_job: r.workJob && { id: r.workJob.id, work_details: r.workJob.work_details, start_date: r.workJob.start_date.toISOString().slice(0, 10) },
    requester: r.requester,
    amount: Number(r.amount),
    upi_method: r.upi_method,
    upi_id: r.upi_id,
    category: r.category,
    purpose: r.purpose,
    remarks: r.remarks,
    bill_details_required: r.bill_details_required,
    route: r.route,
    status: r.status,
    returned_from: r.returned_from,
    status_changed_at: r.status_changed_at,
    paid_amount: r.paid_amount == null ? null : Number(r.paid_amount),
    paid_at: r.paid_at,
    payment_reference: r.payment_reference,
    payer: r.payer,
    closed_at: r.closed_at,
    closer: r.closer,
    created_at: r.created_at,
    is_mine: r.requested_by === actor.id,
    actions: availableActions(r, actor, ctx),
    /** Actions the viewer may take but that wait on something, with the reason. */
    blocked_actions: blockedActions(r, actor, ctx),
    attachment_counts: files,
    /** Still open, raised with bill details, and no bill attached yet: it cannot close like this. */
    bill_missing: r.bill_details_required && files.BILL === 0 && OPEN_PAYMENT_STATUSES.includes(r.status),
    attach_kinds: attachKindsFor(r, actor),
    /** What it is waiting on and for how many working days; overdue ones show red. */
    timers,
    overdue: timers.some((t) => t.overdue),
    ...(money ? { order_money: money } : {}),
  };
}

/** "name@bank", or "UPI mobile 9876543210": where the money goes, for messages. */
const payeeLabel = (r: { upi_method: string; upi_id: string }) =>
  r.upi_method === "MOBILE" ? `UPI mobile ${r.upi_id}` : r.upi_id;

const canSee = (r: { requested_by: number }, actor: Actor) =>
  isReviewerRole(actor.role) || r.requested_by === actor.id;

/** Orders this requester may raise requests on: a CSM's own, or field staff's job orders. */
function requesterOrderWhere(actor: Actor): Prisma.OrderWhereInput {
  if (actor.role === "CSM") return { created_by: actor.id };
  return { workJobs: { some: jobWhereFor(actor) } };
}

function jobWhereFor(actor: Actor): Prisma.WorkJobWhereInput {
  const live: Prisma.WorkJobWhereInput = { status: { not: "CANCELLED" } };
  return actor.role === "CSM" ? live : { ...live, members: { some: { user_id: actor.id } } };
}

/** Each order's value against what has been asked for and paid out on it so far. */
async function orderMoney(db: Db, orderIds: number[]): Promise<Map<number, OrderMoney>> {
  const ids = [...new Set(orderIds)];
  const out = new Map<number, OrderMoney>();
  if (ids.length === 0) return out;

  const [orders, asked, paid] = await Promise.all([
    db.order.findMany({ where: { id: { in: ids } }, select: { id: true, items: true } }),
    db.paymentRequest.groupBy({
      by: ["order_id"],
      where: { order_id: { in: ids }, status: { in: LIVE_PAYMENT_STATUSES } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.paymentRequest.groupBy({
      by: ["order_id"],
      where: { order_id: { in: ids }, status: { in: ["PAID", "CLOSED"] } },
      _sum: { paid_amount: true },
    }),
  ]);
  for (const o of orders) {
    const a = asked.find((x) => x.order_id === o.id);
    const p = paid.find((x) => x.order_id === o.id);
    const order_value = computeTotals(o.items).total_amount;
    const requested = Number(a?._sum.amount ?? 0);
    out.set(o.id, {
      order_value,
      requested,
      paid: Number(p?._sum.paid_amount ?? 0),
      requests: a?._count._all ?? 0,
      over_value: requested > order_value + 0.005,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ notifications */

const kindFor: Partial<Record<WorkflowAction, string>> = {
  APPROVE: "success",
  MARK_PAID: "success",
  REJECT: "warning",
  RETURN: "warning",
  CANCEL: "warning",
};

async function notifyRole(tx: Prisma.TransactionClient, role: Role | undefined, title: string, body: string, kind = "info") {
  if (!role) return;
  const users = await tx.user.findMany({ where: { role, is_active: true }, select: { id: true } });
  if (users.length === 0) return;
  await tx.notification.createMany({ data: users.map((u) => ({ user_id: u.id, title, body, kind })) });
}

async function notifyAfter(
  tx: Prisma.TransactionClient,
  action: WorkflowAction,
  r: RequestRow,
  to: PaymentRequestStatus,
  actor: Actor,
  note: string | null,
  paid?: { amount: number; reference: string; shortBy: number },
) {
  // A request goes by its order's number; the amount tells two on one order apart.
  const no = r.order.order_no;
  const amount = formatRupees(Number(r.amount));
  const about = `${no}: ${amount} for ${r.requester.name}.`;
  const payTo = payeeLabel(r);
  const kind = kindFor[action] ?? "info";
  const ref = { type: "payment_request" as const, id: r.id };
  // In-app and WhatsApp go out together, in this transaction: no change, no message.
  const toRequester = async (title: string, body: string, wa: [WaEvent, unknown[]]) => {
    if (r.requested_by === actor.id) return;
    await tx.notification.create({ data: { user_id: r.requested_by, title, body, kind } });
    await queueWhatsApp(tx, wa[0], [r.requested_by], wa[1], ref);
  };
  // Reviewers are named by stage; Cost Control's stage goes to the Admin while none is active.
  const toReviewers = async (stage: PaymentRequestStatus | null | undefined, title: string, body: string, wa: [WaEvent, unknown[]], k = "info") => {
    const role = await reviewerRoleFor(tx, stage);
    await notifyRole(tx, role, title, body, k);
    await queueWhatsAppRole(tx, wa[0], role, wa[1], ref, actor.id);
  };
  const who = [no, amount, r.requester.name];

  switch (action) {
    case "APPROVE":
      if (to === "CCM_REVIEW") {
        await toReviewers("CCM_REVIEW", "Payment request to review", `${about} Approved by the Admin.`, [
          "PAYMENT_TO_REVIEW",
          [...who, "Approved by the Admin"],
        ]);
        await toRequester("Payment request approved by Admin", `Your ${amount} request on ${no} is now with Cost Control for review.`, [
          "PAYMENT_UPDATE",
          [no, amount, "approved by the Admin", "It is now with Cost Control for review"],
        ]);
      } else {
        await toRequester("Payment request approved", `${no}: ${amount} will be paid to ${payTo}.`, [
          "PAYMENT_UPDATE",
          [no, amount, "approved", `It will be paid to ${payTo}`],
        ]);
      }
      break;
    case "REJECT":
      await toRequester("Payment request rejected", `${no}: ${note}`, ["PAYMENT_UPDATE", [no, amount, "rejected", note]]);
      break;
    case "RETURN":
      await toRequester("Payment request returned", `${no} needs more information: ${note}`, [
        "PAYMENT_UPDATE",
        [no, amount, "returned for more information", note],
      ]);
      break;
    case "RESUBMIT":
      await toReviewers(to, "Payment request resubmitted", about, [
        "PAYMENT_TO_REVIEW",
        [...who, "Resubmitted with the information asked for"],
      ]);
      break;
    case "CANCEL":
      if (r.requested_by === actor.id) {
        const stage = r.status === "INFO_REQUESTED" ? r.returned_from : r.status;
        await toReviewers(stage, "Payment request withdrawn", about, ["PAYMENT_WITHDRAWN", who]);
      } else {
        await toRequester("Payment request cancelled", `${no}: ${note}`, ["PAYMENT_UPDATE", [no, amount, "cancelled", note]]);
      }
      break;
    case "MARK_PAID":
      await toRequester(
        "Payment sent",
        `${no}: ${formatRupees(paid!.amount)} paid to ${payTo}. Reference ${paid!.reference}.` +
          (paid!.shortBy ? ` ${formatRupees(paid!.shortBy)} less than asked: ${note}` : ""),
        ["PAYMENT_PAID", [formatRupees(paid!.amount), payTo, no, paid!.reference]],
      );
      break;
    case "CLOSE":
      break;
  }
}

/* ------------------------------------------------------------------ requester */

/** GET /order-options?q= — orders the requester can pick, with whether each is open. */
export const orderOptions = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const q = String(req.query.q ?? "").trim().slice(0, 60);
    const and: Prisma.OrderWhereInput[] = [requesterOrderWhere(actor)];
    if (q) {
      and.push({
        OR: [
          { order_no: { contains: q, mode: "insensitive" } },
          { client_name: { contains: q, mode: "insensitive" } },
        ],
      });
    }
    const orders = await prisma.order.findMany({
      where: { AND: and },
      include: {
        ...eligibilityInclude,
        workJobs: {
          where: jobWhereFor(actor),
          select: { id: true, work_details: true, start_date: true, status: true },
          orderBy: { start_date: "desc" },
          take: 10,
        },
      },
      orderBy: { created_at: "desc" },
      take: 30,
    });

    const options = orders.map((o) => ({
      id: o.id,
      order_no: o.order_no,
      client_name: o.client_name,
      status: o.status,
      eligibility: paymentEligibility(o),
      jobs: o.workJobs.map((j) => ({ ...j, start_date: j.start_date.toISOString().slice(0, 10) })),
    }));
    // Open orders first; newest first within each group.
    options.sort((a, b) => Number(b.eligibility.eligible) - Number(a.eligibility.eligible));
    return res.json({ orders: options });
  } catch (err) {
    return sendError(res, err);
  }
};

/** POST / — raise a request. A repeated idempotency key returns the first request. */
export const createRequest = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const body = parseBody(paymentRequestSchema, req.body);

    const existing = await prisma.paymentRequest.findUnique({
      where: { idempotency_key: body.idempotency_key },
      include: requestInclude,
    });
    if (existing) {
      if (existing.requested_by !== actor.id) throw new HttpError(409, "This request was already submitted.");
      return res.status(200).json({ request: serializeRequest(existing, actor, undefined, await overdueDays()), duplicate: true });
    }

    const created = await withAudit(actor.id, async (tx) => {
      const order = await tx.order.findFirst({
        where: { AND: [{ id: body.order_id }, requesterOrderWhere(actor)] },
        include: eligibilityInclude,
      });
      if (!order) {
        throw new HttpError(404, "Order not found, or it is not one you can raise a payment request for.");
      }
      const eligibility = paymentEligibility(order);
      if (!eligibility.eligible) throw new HttpError(409, eligibility.reason, { eligibility });

      if (body.work_job_id) {
        const job = await tx.workJob.findFirst({
          where: { AND: [{ id: body.work_job_id, order_id: order.id }, jobWhereFor(actor)] },
          select: { id: true },
        });
        if (!job) throw new HttpError(400, "That job is not on this order, or you are not on it.");
      }

      const route = routeFor(body.bill_details_required);
      const adminThreshold = await getSetting("payment_admin_threshold");
      const status = entryStage(route, body.amount, adminThreshold);
      const overLimit = status === "ADMIN_REVIEW" && route === "CCM_ONLY";
      const reviewerRole = await reviewerRoleFor(tx, status);

      const row = await tx.paymentRequest.create({
        data: {
          order_id: order.id,
          work_job_id: body.work_job_id ?? null,
          requested_by: actor.id,
          amount: body.amount,
          upi_method: body.upi_method,
          upi_id: body.upi_id,
          category: body.category ?? null,
          purpose: body.purpose,
          remarks: body.remarks || null,
          bill_details_required: body.bill_details_required,
          route,
          status,
          idempotency_key: body.idempotency_key,
          events: {
            create: {
              action: "SUBMIT",
              from_status: null,
              to_status: status,
              actor_id: actor.id,
              actor_role: actor.role as Role,
              note: [
                body.bill_details_required ? "Bill details given" : "No bill details",
                overLimit ? `Over the ${formatRupees(adminThreshold)} Admin review limit` : null,
              ]
                .filter(Boolean)
                .join(". "),
            },
          },
        },
        include: requestInclude,
      });

      await notifyRole(
        tx,
        reviewerRole,
        "New payment request",
        `${order.order_no}: ${formatRupees(body.amount)} for ${row.requester.name}.`,
      );
      await queueWhatsAppRole(
        tx,
        "PAYMENT_TO_REVIEW",
        reviewerRole,
        [
          order.order_no,
          formatRupees(body.amount),
          row.requester.name,
          overLimit
            ? "New request over the Admin review limit"
            : body.bill_details_required
              ? "New request with bill details"
              : "New request without bill details",
        ],
        { type: "payment_request", id: row.id },
        actor.id,
      );
      return row;
    });

    // Warn only: there is no cap, but the requester should know the order is over.
    const money = (await orderMoney(prisma, [created.order_id])).get(created.order_id);
    const warning = money?.over_value
      ? `Requests on ${created.order.order_no} now add up to more than the order value. Reviewers will see this.`
      : null;
    return res.status(201).json({ request: serializeRequest(created, actor, undefined, await overdueDays()), warning });
  } catch (err: any) {
    // Two submits with the same key racing: hand back the one that won.
    if (err?.code === "P2002" && String(err?.meta?.target ?? "").includes("idempotency_key")) {
      const again = await prisma.paymentRequest.findUnique({
        where: { idempotency_key: String(req.body?.idempotency_key) },
        include: requestInclude,
      });
      if (again && again.requested_by === req.user!.id) {
        return res.status(200).json({ request: serializeRequest(again, req.user!, undefined, await overdueDays()), duplicate: true });
      }
    }
    return sendError(res, err);
  }
};

/* ------------------------------------------------------------------ lists */

/** What each reviewer has to act on. */
const QUEUE: Partial<Record<string, PaymentRequestStatus[]>> = {
  ADMIN: ["ADMIN_REVIEW"],
  COST_CONTROL_MANAGER: ["CCM_REVIEW", "PAYMENT_PENDING", "PAID"],
};

/** The Admin's queue takes in Cost Control's while no Cost Control Manager is active. */
const queueFor = (role: string, ccmMissing: boolean): PaymentRequestStatus[] =>
  role === "ADMIN" && ccmMissing ? [...QUEUE.ADMIN!, ...QUEUE.COST_CONTROL_MANAGER!] : (QUEUE[role] ?? []);

const ALL_STATUSES = Object.keys(STATUS_LABELS) as PaymentRequestStatus[];

/**
 * GET / — requesters get their own requests; reviewers get everything, or with
 * `scope=queue` only what waits on them (oldest first).
 */
export const listRequests = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const reviewer = isReviewerRole(actor.role);
    const base: Prisma.PaymentRequestWhereInput = reviewer ? {} : { requested_by: actor.id };
    const and: Prisma.PaymentRequestWhereInput[] = [base];

    const ccmMissing = await noActiveCcm(prisma);
    const queue = reviewer && req.query.scope === "queue";
    if (queue) and.push({ status: { in: queueFor(actor.role, ccmMissing) } });

    const statuses = String(req.query.status ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is PaymentRequestStatus => (ALL_STATUSES as string[]).includes(s));
    if (statuses.length) and.push({ status: { in: statuses } });

    const orderId = parseInt(String(req.query.order_id ?? ""), 10);
    if (Number.isInteger(orderId)) and.push({ order_id: orderId });

    const q = String(req.query.q ?? "").trim().slice(0, 60);
    if (q) {
      and.push({
        OR: [
          // Numbers issued before requests went by their order's number still find them.
          { request_no: { contains: q, mode: "insensitive" } },
          { purpose: { contains: q, mode: "insensitive" } },
          { order: { order_no: { contains: q, mode: "insensitive" } } },
          { order: { client_name: { contains: q, mode: "insensitive" } } },
          { requester: { name: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    const [rows, grouped] = await Promise.all([
      prisma.paymentRequest.findMany({
        where: { AND: and },
        include: requestInclude,
        orderBy: queue ? { status_changed_at: "asc" } : { created_at: "desc" },
        take: 300,
      }),
      prisma.paymentRequest.groupBy({ by: ["status"], where: base, _count: { _all: true }, _sum: { amount: true } }),
    ]);

    const money = reviewer ? await orderMoney(prisma, rows.map((r) => r.order_id)) : null;
    const threshold = await overdueDays();
    const serialized = rows.map((r) => serializeRequest(r, actor, money?.get(r.order_id), threshold, ccmMissing));
    const overdueOnly = req.query.overdue === "1";
    const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<PaymentRequestStatus, number>;
    const amounts = { ...counts };
    for (const g of grouped) {
      counts[g.status] = g._count._all;
      amounts[g.status] = Number(g._sum.amount ?? 0);
    }

    return res.json({
      requests: overdueOnly ? serialized.filter((r) => r.overdue) : serialized,
      overdue_count: serialized.filter((r) => r.overdue).length,
      threshold,
      counts,
      amounts,
      queue_statuses: queueFor(actor.role, ccmMissing),
      /** The Admin is standing in for Cost Control because no Cost Control Manager is active. */
      acting_for_ccm: actor.role === "ADMIN" && ccmMissing,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/** GET /:id — one request with its full history. */
export const getRequest = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const id = parseId(req.params.id);
    const r = await prisma.paymentRequest.findUnique({
      where: { id },
      include: {
        ...requestInclude,
        events: { include: { actor: { select: { id: true, name: true } } }, orderBy: { id: "asc" } },
      },
    });
    if (!r || !canSee(r, actor)) throw new HttpError(404, "Payment request not found");

    const files = await prisma.paymentAttachment.findMany({
      where: { request_id: r.id, deleted_at: null },
      include: fileInclude,
      orderBy: { id: "asc" },
    });
    const money = isReviewerRole(actor.role) ? (await orderMoney(prisma, [r.order_id])).get(r.order_id) : undefined;
    const approvedOnce = approvedOnceIn(r.events);
    return res.json({
      request: serializeRequest(r, actor, money, await overdueDays(), await noActiveCcm(prisma)),
      attachments: files.map((f) => serializeFile(f, r, actor, approvedOnce)),
      events: r.events.map((e) => ({
        id: e.id,
        action: e.action,
        from_status: e.from_status,
        to_status: e.to_status,
        actor: e.actor,
        actor_role: e.actor_role,
        note: e.note,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/* ------------------------------------------------------------------ workflow */

/**
 * POST /:id/<action> — one handler for every move. The status the request was read in is
 * part of the update's WHERE, so two reviewers acting at once cannot both win.
 */
export const transition = (action: WorkflowAction) => async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const id = parseId(req.params.id);

    const resubmit = action === "RESUBMIT" ? parseBody(paymentResubmitSchema, req.body) : null;
    const paidBody = action === "MARK_PAID" ? parseBody(paymentMarkPaidSchema, req.body) : null;
    const note = (resubmit?.note ?? paidBody?.note ?? parseBody(paymentNoteSchema, pickNote(req.body)).note) || null;

    const updated = await withAudit(actor.id, async (tx) => {
      const r = await tx.paymentRequest.findUnique({ where: { id }, include: requestInclude });
      if (!r || !canSee(r, actor)) throw new HttpError(404, "Payment request not found");

      // Everything the rules need beyond the row, read inside the transaction: bills on file
      // (approving or closing a bill request needs one), whether the Admin approved it, and
      // whether the Admin is standing in for an absent Cost Control.
      const ctx: TransitionContext = {
        billCount: await tx.paymentAttachment.count({ where: { request_id: id, kind: "BILL", deleted_at: null } }),
        adminApproved: adminApprovedIn(r.events),
        noActiveCcm: await noActiveCcm(tx),
      };
      if (action === "RESUBMIT" && resubmit) {
        ctx.materialChange = isMaterialChange(
          { amount: Number(r.amount), upi_method: r.upi_method, upi_id: r.upi_id },
          resubmit,
        );
        ctx.entryStage = entryStage(r.route, resubmit.amount, await getSetting("payment_admin_threshold"));
      }
      const check = checkTransition(r, action, actor, note, ctx);
      if (!check.ok) throw new HttpError(check.status, check.message);

      const now = new Date();
      const data: Prisma.PaymentRequestUncheckedUpdateManyInput = { status: check.to, status_changed_at: now };
      const changes: string[] = [];
      let paid: { amount: number; reference: string; shortBy: number } | undefined;

      if (action === "RETURN") data.returned_from = r.status;
      if (action === "RESUBMIT" && resubmit) {
        data.returned_from = null;
        if (Number(r.amount) !== resubmit.amount) {
          changes.push(`amount ${formatRupees(Number(r.amount))} → ${formatRupees(resubmit.amount)}`);
        }
        if (r.upi_id !== resubmit.upi_id || r.upi_method !== resubmit.upi_method) {
          changes.push(`pay to ${payeeLabel(r)} → ${payeeLabel(resubmit)}`);
        }
        if (r.purpose !== resubmit.purpose) changes.push("purpose");
        if ((r.category ?? null) !== (resubmit.category ?? null)) changes.push("category");
        if ((r.remarks ?? null) !== (resubmit.remarks || null)) changes.push("remarks");
        Object.assign(data, {
          amount: resubmit.amount,
          upi_method: resubmit.upi_method,
          upi_id: resubmit.upi_id,
          purpose: resubmit.purpose,
          category: resubmit.category ?? null,
          remarks: resubmit.remarks || null,
        });
      }
      if (action === "MARK_PAID" && paidBody) {
        const amount = paidBody.paid_amount ?? Number(r.amount);
        if (amount > Number(r.amount) + 0.005) {
          throw new HttpError(409, `The amount paid cannot be more than the ${formatRupees(Number(r.amount))} asked for.`);
        }
        // Paying less than asked needs a reason, which the requester is told (GAP-B04).
        const shortBy = Number(r.amount) - amount;
        if (shortBy > 0.005 && !note?.trim()) {
          throw new HttpError(400, `Say why ${formatRupees(shortBy)} less than asked is being paid.`);
        }
        paid = { amount, reference: paidBody.payment_reference, shortBy: shortBy > 0.005 ? shortBy : 0 };
        Object.assign(data, {
          paid_amount: amount,
          paid_at: now,
          payment_reference: paidBody.payment_reference,
          paid_by: actor.id,
        });
      }
      if (action === "CLOSE") Object.assign(data, { closed_at: now, closed_by: actor.id });

      const { count } = await tx.paymentRequest.updateMany({ where: { id, status: r.status }, data });
      if (count === 0) throw new HttpError(409, "Someone else changed this request just now. Reload and try again.");

      const eventNote = [
        paid ? `Paid ${formatRupees(paid.amount)}, reference ${paid.reference}` : null,
        paid?.shortBy ? `${formatRupees(paid.shortBy)} less than asked` : null,
        changes.length ? `Changed ${changes.join(", ")}` : null,
        ctx.materialChange ? "Sent back to the start of review because the amount went up or the payee changed" : null,
        note,
      ]
        .filter(Boolean)
        .join(". ");
      await tx.paymentRequestEvent.create({
        data: {
          request_id: id,
          action,
          from_status: r.status,
          to_status: check.to,
          actor_id: actor.id,
          actor_role: actor.role as Role,
          note: eventNote || null,
        },
      });
      await notifyAfter(tx, action, r, check.to, actor, note, paid);

      return tx.paymentRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    });

    const money = isReviewerRole(actor.role)
      ? (await orderMoney(prisma, [updated.order_id])).get(updated.order_id)
      : undefined;
    return res.json({ request: serializeRequest(updated, actor, money, await overdueDays(), await noActiveCcm(prisma)) });
  } catch (err) {
    return sendError(res, err);
  }
};

/** Only the note is read from a plain action's body; anything else sent is ignored. */
const pickNote = (body: unknown) => ({ note: (body as { note?: unknown } | null)?.note ?? null });

/* ------------------------------------------------------------------ attachments */

const fileInclude = {
  uploader: { select: { id: true, name: true } },
} satisfies Prisma.PaymentAttachmentInclude;

type FileRow = Prisma.PaymentAttachmentGetPayload<{ include: typeof fileInclude }>;

function serializeFile(
  f: FileRow,
  r: { id: number; status: PaymentRequestStatus; requested_by: number },
  actor: Actor,
  approvedOnce = false,
) {
  return {
    id: f.id,
    kind: f.kind,
    name: f.original_name,
    mime: f.mime,
    size_bytes: f.size_bytes,
    uploader: f.uploader,
    uploaded_at: f.uploaded_at,
    /** Relative to the API base. */
    url: `/payment-requests/${r.id}/attachments/${f.id}`,
    can_remove: canRemoveFile(r, f, actor, { approvedOnce }),
    /** Removing someone else's file needs a note, kept in the history. */
    remove_needs_note: f.uploaded_by !== actor.id,
  };
}

const KINDS: PaymentAttachmentKind[] = ["BILL", "PHOTO", "RECEIPT"];

/** Two uploads of the same file racing: the exclusion constraint keeps one. */
const isDuplicateFile = (err: any) => String(err?.message ?? "").includes("PaymentAttachment_no_duplicate");

/**
 * POST /:id/attachments?kind=BILL&name=bill.pdf — the request body is the file itself.
 * Its type is read from its bytes; anything but JPG, PNG, WEBP, HEIC or PDF is refused.
 */
export const uploadAttachment = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const id = parseId(req.params.id);
    const kind = String(req.query.kind ?? "") as PaymentAttachmentKind;
    if (!KINDS.includes(kind)) throw new HttpError(400, "Say whether this is a bill, photo or receipt.");
    const name = cleanFileName(req.query.name);

    const data = Buffer.isBuffer(req.body) ? req.body : null;
    if (!data || data.length === 0) throw new HttpError(400, "Choose a file to attach.");
    if (data.length > MAX_FILE_BYTES) throw new HttpError(413, `Files can be up to ${MAX_FILE_LABEL}.`);
    const mime = detectFileType(data);
    if (!mime) throw new HttpError(415, "Only photos (JPG, PNG, WEBP, HEIC) and PDF files can be attached.");
    const sha256 = createHash("sha256").update(data).digest("hex");

    const created = await withAudit(actor.id, async (tx) => {
      const r = await tx.paymentRequest.findUnique({
        where: { id },
        select: { id: true, order_id: true, status: true, requested_by: true },
      });
      if (!r || !canSee(r, actor)) throw new HttpError(404, "Payment request not found");

      const kinds = attachKindsFor(r, actor);
      if (kinds.length === 0) {
        throw new HttpError(409, `This request is ${STATUS_LABELS[r.status].toLowerCase()}, so files can no longer be added.`);
      }
      if (!kinds.includes(kind)) {
        throw new HttpError(403, `You cannot add a ${ATTACHMENT_KIND_LABELS[kind].toLowerCase()} to this request.`);
      }

      const live = await tx.paymentAttachment.findMany({
        where: { request_id: id, deleted_at: null },
        select: { sha256: true },
      });
      if (live.some((f) => f.sha256 === sha256)) throw new HttpError(409, "That file is already attached.");
      if (live.length >= MAX_FILES_PER_REQUEST) {
        throw new HttpError(409, `A request can hold up to ${MAX_FILES_PER_REQUEST} files. Remove one first.`);
      }

      const store = currentStore();
      const row = await tx.paymentAttachment.create({
        data: {
          request_id: id,
          order_id: r.order_id,
          kind,
          original_name: name,
          mime,
          size_bytes: data.length,
          sha256,
          storage: store.name,
          uploaded_by: actor.id,
        },
      });
      const key = await store.put(tx, row.id, data);
      if (key) await tx.paymentAttachment.update({ where: { id: row.id }, data: { storage_key: key } });

      await tx.paymentRequestEvent.create({
        data: {
          request_id: id,
          action: "ATTACH",
          from_status: r.status,
          to_status: r.status,
          actor_id: actor.id,
          actor_role: actor.role as Role,
          note: `${ATTACHMENT_KIND_LABELS[kind]}: ${name}`,
        },
      });
      const file = await tx.paymentAttachment.findUniqueOrThrow({ where: { id: row.id }, include: fileInclude });
      const approvedOnce = (await tx.paymentRequestEvent.count({ where: { request_id: id, action: "APPROVE" } })) > 0;
      return { file, r, approvedOnce };
    });

    return res.status(201).json({ attachment: serializeFile(created.file, created.r, actor, created.approvedOnce) });
  } catch (err) {
    if (isDuplicateFile(err)) return res.status(409).json({ message: "That file is already attached." });
    return sendError(res, err);
  }
};

/** GET /:id/attachments/:fileId — the file, to anyone who can see the request. `?download=1` saves it. */
export const downloadAttachment = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const id = parseId(req.params.id);
    const fileId = parseId(req.params.fileId);
    const file = await prisma.paymentAttachment.findFirst({
      where: { id: fileId, request_id: id, deleted_at: null },
      include: { request: { select: { requested_by: true } } },
    });
    if (!file || !canSee(file.request, actor)) throw new HttpError(404, "File not found");

    const data = await storeFor(file.storage).get(file);
    if (!data) throw new HttpError(404, "File not found");

    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Length", String(data.length));
    res.setHeader("Content-Disposition", contentDisposition(file.original_name, req.query.download === "1"));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).end(data);
  } catch (err) {
    return sendError(res, err);
  }
};

/**
 * DELETE /:id/attachments/:fileId — a soft delete; the file stays in the database and the
 * history. Removing a file someone else added needs a `note` in the body.
 */
export const removeAttachment = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const id = parseId(req.params.id);
    const fileId = parseId(req.params.fileId);
    const note = parseBody(paymentNoteSchema, pickNote(req.body)).note?.trim() || null;

    await withAudit(actor.id, async (tx) => {
      const file = await tx.paymentAttachment.findFirst({
        where: { id: fileId, request_id: id, deleted_at: null },
        include: { request: { select: { id: true, status: true, requested_by: true } } },
      });
      if (!file || !canSee(file.request, actor)) throw new HttpError(404, "File not found");
      const approvedOnce = (await tx.paymentRequestEvent.count({ where: { request_id: id, action: "APPROVE" } })) > 0;
      if (!canRemoveFile(file.request, file, actor, { approvedOnce })) {
        throw new HttpError(
          403,
          approvedOnce && file.uploaded_by === actor.id
            ? "This request has been approved, so its files stay. You can still add more."
            : "Only whoever added this file, or a reviewer, can remove it while the request is open.",
        );
      }
      if (file.uploaded_by !== actor.id && !note) {
        throw new HttpError(400, "Say why you are removing a file someone else added.");
      }
      const { count } = await tx.paymentAttachment.updateMany({
        where: { id: fileId, deleted_at: null },
        data: { deleted_at: new Date(), deleted_by: actor.id },
      });
      if (count === 0) throw new HttpError(409, "That file was already removed.");
      await tx.paymentRequestEvent.create({
        data: {
          request_id: id,
          action: "DETACH",
          from_status: file.request.status,
          to_status: file.request.status,
          actor_id: actor.id,
          actor_role: actor.role as Role,
          note: [`${ATTACHMENT_KIND_LABELS[file.kind]}: ${file.original_name}`, note].filter(Boolean).join(". "),
        },
      });
    });
    return res.json({ ok: true });
  } catch (err) {
    return sendError(res, err);
  }
};

/* ------------------------------------------------------------------ dashboard */

/** Start of this month and of last month, in India time. */
function istMonthStarts(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const at = (y: number, m: number) => new Date(Date.UTC(y, m, 1) - 330 * 60_000);
  return { thisMonth: at(ist.getUTCFullYear(), ist.getUTCMonth()), lastMonth: at(ist.getUTCFullYear(), ist.getUTCMonth() - 1) };
}

/** The statuses a request waits in, in the order the dashboard shows them. */
const WAITING: PaymentRequestStatus[] = ["ADMIN_REVIEW", "CCM_REVIEW", "INFO_REQUESTED", "PAYMENT_PENDING", "PAID"];

/**
 * GET /dashboard — for the Admin and Cost Control: where requests are waiting and for how
 * long, every overdue timer (oldest first), what is waiting on the viewer, and money paid out.
 */
export const dashboard = async (req: Request, res: Response) => {
  try {
    const actor = req.user!;
    const threshold = await overdueDays();
    const now = new Date();
    const { thisMonth, lastMonth } = istMonthStarts(now);

    const [open, paidThis, paidLast, askedThis, byCategory] = await Promise.all([
      prisma.paymentRequest.findMany({
        where: { status: { in: WAITING } },
        select: {
          id: true,
          amount: true,
          status: true,
          bill_details_required: true,
          status_changed_at: true,
          created_at: true,
          requester: { select: { id: true, name: true, role: true } },
          order: { select: { id: true, order_no: true, client_name: true } },
          _count: { select: { attachments: { where: { deleted_at: null, kind: "BILL" } } } },
        },
        orderBy: { status_changed_at: "asc" },
      }),
      prisma.paymentRequest.aggregate({ where: { paid_at: { gte: thisMonth } }, _sum: { paid_amount: true }, _count: { _all: true } }),
      prisma.paymentRequest.aggregate({ where: { paid_at: { gte: lastMonth, lt: thisMonth } }, _sum: { paid_amount: true }, _count: { _all: true } }),
      prisma.paymentRequest.aggregate({ where: { created_at: { gte: thisMonth }, status: { not: "CANCELLED" } }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.paymentRequest.groupBy({ by: ["category"], where: { paid_at: { gte: thisMonth } }, _sum: { paid_amount: true }, _count: { _all: true } }),
    ]);

    const stages = Object.fromEntries(
      WAITING.map((s) => [s, { count: 0, amount: 0, oldest_days: 0, overdue: 0 }]),
    ) as Record<PaymentRequestStatus, { count: number; amount: number; oldest_days: number; overdue: number }>;
    const byKind: Record<string, number> = {};
    const overdueItems: { timer: { days: number } }[] = [];
    const mine = ownerFor(actor.role);
    const waitingOnYou = { count: 0, overdue: 0, amount: 0 };
    let billsMissing = 0;

    for (const r of open) {
      const timers = paymentTimers(r, r._count.attachments, threshold, now);
      const stage = stages[r.status];
      const amount = Number(r.amount);
      stage.count++;
      stage.amount += amount;
      for (const t of timers) {
        if (t.kind === "BILL") billsMissing++;
        else stage.oldest_days = Math.max(stage.oldest_days, t.days);
        if (!t.overdue) continue;
        if (t.kind !== "BILL") stage.overdue++;
        byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
        overdueItems.push({ id: r.id, amount, status: r.status, requester: r.requester, order: r.order, timer: t } as never);
      }
      const onYou = timers.filter((t) => t.owner === mine);
      if (onYou.length) {
        waitingOnYou.count++;
        waitingOnYou.amount += amount;
        if (onYou.some((t) => t.overdue)) waitingOnYou.overdue++;
      }
    }
    overdueItems.sort((a, b) => b.timer.days - a.timer.days);

    return res.json({
      threshold,
      stages,
      waiting_on_you: { owner: mine, ...waitingOnYou },
      overdue: { total: overdueItems.length, by_kind: byKind, items: overdueItems.slice(0, 100) },
      bills_missing: billsMissing,
      money: {
        paid_this_month: { amount: Number(paidThis._sum.paid_amount ?? 0), count: paidThis._count._all },
        paid_last_month: { amount: Number(paidLast._sum.paid_amount ?? 0), count: paidLast._count._all },
        asked_this_month: { amount: Number(askedThis._sum.amount ?? 0), count: askedThis._count._all },
        pending_payout: stages.PAYMENT_PENDING.amount,
        by_category: byCategory
          .map((g) => ({ category: g.category, amount: Number(g._sum.paid_amount ?? 0), count: g._count._all }))
          .sort((a, b) => b.amount - a.amount),
      },
    });
  } catch (err) {
    return sendError(res, err);
  }
};
