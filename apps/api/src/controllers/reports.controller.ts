import { Request, Response } from "express";
import * as xlsx from "xlsx";
import type { Role } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { serializeDecimals } from "../utils/serialize";
import {
  ADJUSTMENT_REMARKS,
  LOSS_REMARKS,
  computeTotals,
  itemAdjustment,
  orderAdjustmentValue,
} from "../utils/order-totals";
import { CLOSED_STATUSES, OPEN_STATUSES } from "../utils/order-status";
import { averageCycleDays, businessDaysBetween, closedAt, currentStage } from "../utils/order-stage";
import { OPEN_PAYMENT_STATUSES } from "../utils/payment-workflow";
import {
  RangeError400,
  ageBucket,
  bucketLabels,
  calendarDays,
  daysOf,
  inRange,
  istDay,
  istMonth,
  mean1,
  monthLabel,
  monthsOf,
  overlapDays,
  parseRange,
  pct,
  round1,
  round2,
  tally,
  todayIst,
  workingDaysIn,
  type ReportRange,
} from "../utils/report-range";

/**
 * Reports: one endpoint per tab of the Reports page, each over a date range read in India
 * time (see utils/report-range.ts). `GET /api/reports/:tab` answers JSON for the page and
 * `GET /api/reports/:tab/export` the same figures as an Excel workbook, one sheet per table.
 *
 * Money figures follow utils/order-totals.ts: an order's value is its billable total (plain
 * work + confirmed adjustments − confirmed losses), never the raw line sum.
 */

interface Filters {
  /** Only orders this user created. */
  csm?: number;
  /** Only orders for this client (exact name). */
  client?: string;
}

/** A table for the Excel export: one sheet, its columns in the order of the first row's keys. */
interface Sheet {
  name: string;
  rows: Record<string, unknown>[];
}

interface Built {
  data: Record<string, unknown>;
  sheets: Sheet[];
}

const STAGE_EDGES = [2, 5, 10];
const AGING_EDGES = [30, 60, 90];
/** Open orders stuck in their stage longer than this count as overdue, as on Overdue Orders. */
const OVERDUE_DAYS = 5;

const INVOICE_FIELDS = {
  invoice_no: true,
  bill_amount: true,
  billing_date: true,
  billing_completed_at: true,
  amount_received: true,
  payment_received_at: true,
  payment_received_by: true,
} as const;

const num = (v: unknown) => Number(v) || 0;
const sum = <T>(xs: T[], f: (x: T) => number) => round2(xs.reduce((s, x) => s + f(x), 0));

function orderWhere(f: Filters) {
  const w: Record<string, unknown> = {};
  if (f.csm) w.created_by = f.csm;
  if (f.client) w.client_name = f.client;
  return w;
}

function parseFilters(q: Request["query"]): Filters {
  const csm = Number(q.csm);
  const client = typeof q.client === "string" ? q.client.trim() : "";
  return {
    csm: Number.isInteger(csm) && csm > 0 ? csm : undefined,
    client: client || undefined,
  };
}

/** Rows sorted biggest first by `by`, cut to `limit` when given. */
function rank<T extends Record<string, any>>(rows: T[], by: keyof T, limit?: number): T[] {
  const sorted = rows.slice().sort((a, b) => num(b[by]) - num(a[by]));
  return limit ? sorted.slice(0, limit) : sorted;
}

/** "Figure / Value" rows for the export's Summary sheet. */
const summarySheet = (r: ReportRange, f: Filters, figures: [string, unknown][]): Sheet => ({
  name: "Summary",
  rows: [
    { Figure: "From", Value: r.from },
    { Figure: "To", Value: r.to },
    ...(f.csm ? [{ Figure: "Created by (user id)", Value: f.csm }] : []),
    ...(f.client ? [{ Figure: "Client", Value: f.client }] : []),
    ...figures.map(([Figure, Value]) => ({ Figure, Value: Value ?? "—" })),
  ],
});

// ---------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------

const ORDER_INCLUDE = {
  items: { include: { assignments: { select: { assigned_at: true } } } },
  stores: { select: { id: true, location: true, store_name: true, installed_at: true, installed_by: true } },
  invoices: { select: INVOICE_FIELDS },
  adjustments: { where: { status: "Approved" as const } },
};

const isWaiting = (o: { stores: unknown[]; items: unknown[] }) => o.stores.length === 0 && o.items.length === 0;

async function ordersReport(r: ReportRange, f: Filters): Promise<Built> {
  const base = orderWhere(f);
  const [created, open, closedRecent] = await Promise.all([
    prisma.order.findMany({ where: { ...base, created_at: { gte: r.start, lt: r.end } }, include: ORDER_INCLUDE }),
    prisma.order.findMany({ where: { ...base, status: { in: OPEN_STATUSES } }, include: ORDER_INCLUDE }),
    // A closed order's closing moment is never after its last update, so this is enough.
    prisma.order.findMany({
      where: { ...base, status: { in: CLOSED_STATUSES }, updated_at: { gte: r.start } },
      select: { id: true, status: true, created_at: true, updated_at: true, invoices: { select: INVOICE_FIELDS } },
    }),
  ]);
  const closed = closedRecent.filter((o) => inRange(closedAt(o), r));
  const totals = new Map(created.map((o) => [o.id, computeTotals(o.items, o.adjustments)]));
  const openTotals = new Map(open.map((o) => [o.id, computeTotals(o.items, o.adjustments).total_amount]));
  const value = (id: number) => totals.get(id)?.total_amount ?? 0;

  const createdValue = sum(created, (o) => value(o.id));
  const waiting = open.filter(isWaiting);
  const kpis = {
    created: created.length,
    created_value: createdValue,
    avg_value: created.length ? round2(createdValue / created.length) : null,
    items: created.reduce((s, o) => s + o.items.length, 0),
    stores: created.reduce((s, o) => s + o.stores.length, 0),
    total_sft: sum(created.flatMap((o) => o.items), (i) => num(i.total_sft)),
    loss_value: sum(created, (o) => totals.get(o.id)!.loss_amount),
    net_adjustment: sum(created, (o) => totals.get(o.id)!.adjustment_amount),
    closed: closed.length,
    avg_cycle_days: averageCycleDays(closed),
    closure_rate: pct(created.filter((o) => (CLOSED_STATUSES as string[]).includes(o.status)).length, created.length),
    open: open.length,
    open_value: round2([...openTotals.values()].reduce((s, v) => s + v, 0)),
    waiting: waiting.length,
  };

  const months = monthsOf(r);
  const byMonth = new Map(months.map((m) => [m, { month: m, label: monthLabel(m), created: 0, value: 0, closed: 0 }]));
  for (const o of created) {
    const row = byMonth.get(istMonth(o.created_at));
    if (row) {
      row.created += 1;
      row.value = round2(row.value + value(o.id));
    }
  }
  for (const o of closed) {
    const row = byMonth.get(istMonth(closedAt(o)));
    if (row) row.closed += 1;
  }

  const statusMap = new Map<string, { status: string; count: number; value: number }>();
  for (const o of created) {
    const row = statusMap.get(o.status) ?? { status: o.status, count: 0, value: 0 };
    row.count += 1;
    row.value = round2(row.value + value(o.id));
    statusMap.set(o.status, row);
  }

  // Where open orders sit right now, and for how long (working days, as on Overdue Orders).
  const labels = bucketLabels(STAGE_EDGES);
  const stageMap = new Map<string, { stage: string; count: number; value: number; overdue: number; buckets: Record<string, number> }>();
  const stuck: any[] = [];
  for (const o of open) {
    const s = currentStage(o);
    if (!s) continue;
    const row =
      stageMap.get(s.stage) ??
      { stage: s.stage, count: 0, value: 0, overdue: 0, buckets: Object.fromEntries(labels.map((l) => [l, 0])) };
    row.count += 1;
    row.value = round2(row.value + (openTotals.get(o.id) ?? 0));
    row.buckets[ageBucket(s.days_in_stage, STAGE_EDGES)]! += 1;
    if (s.days_in_stage > OVERDUE_DAYS) row.overdue += 1;
    stageMap.set(s.stage, row);
    stuck.push({
      order_id: o.id,
      order_no: o.order_no,
      client_name: o.client_name,
      creator_name: o.creator_name,
      status: o.status,
      stage: s.stage,
      days: s.days_in_stage,
      value: openTotals.get(o.id) ?? 0,
    });
  }

  const clientMap = new Map<string, { client_name: string; orders: number; value: number; closed: number }>();
  for (const o of created) {
    const row = clientMap.get(o.client_name) ?? { client_name: o.client_name, orders: 0, value: 0, closed: 0 };
    row.orders += 1;
    row.value = round2(row.value + value(o.id));
    if ((CLOSED_STATUSES as string[]).includes(o.status)) row.closed += 1;
    clientMap.set(o.client_name, row);
  }
  const clients = rank([...clientMap.values()], "value").map((c) => ({ ...c, share: pct(c.value, createdValue) }));

  const locationMap = new Map<string, number>();
  for (const o of created) for (const s of o.stores) tally(locationMap, s.location?.trim() || "(blank)");

  const mediaMap = new Map<string, { media: string; lines: number; qty: number; sft: number; amount: number }>();
  for (const i of created.flatMap((o) => o.items)) {
    const row = mediaMap.get(i.media) ?? { media: i.media, lines: 0, qty: 0, sft: 0, amount: 0 };
    row.lines += 1;
    row.qty = round2(row.qty + num(i.qty));
    row.sft = round2(row.sft + num(i.total_sft));
    row.amount = round2(row.amount + num(i.amount));
    mediaMap.set(i.media, row);
  }

  const waitingRows = waiting
    .map((o) => ({
      order_id: o.id,
      order_no: o.order_no,
      client_name: o.client_name,
      creator_name: o.creator_name,
      created_at: o.created_at,
      days: calendarDays(o.created_at),
    }))
    .sort((a, b) => b.days - a.days);

  const data = {
    kpis,
    by_month: [...byMonth.values()],
    by_status: rank([...statusMap.values()], "count"),
    stages: rank([...stageMap.values()], "count"),
    stage_buckets: labels,
    stuck: rank(stuck, "days", 25),
    clients: clients.slice(0, 15),
    locations: rank([...locationMap].map(([location, stores]) => ({ location, stores })), "stores", 12),
    media: rank([...mediaMap.values()], "amount", 15),
    waiting: waitingRows,
  };

  const sheets: Sheet[] = [
    summarySheet(r, f, [
      ["Orders created", kpis.created],
      ["Value created (₹)", kpis.created_value],
      ["Average order value (₹)", kpis.avg_value],
      ["Line items", kpis.items],
      ["Stores", kpis.stores],
      ["Total sft", kpis.total_sft],
      ["Loss on these orders (₹)", kpis.loss_value],
      ["Net adjustments (₹)", kpis.net_adjustment],
      ["Orders closed in range", kpis.closed],
      ["Average cycle (working days)", kpis.avg_cycle_days],
      ["Closure rate of created orders (%)", kpis.closure_rate],
      ["Open orders now", kpis.open],
      ["Open value now (₹)", kpis.open_value],
      ["Allotted, waiting for CSM", kpis.waiting],
    ]),
    {
      name: "By month",
      rows: data.by_month.map((m) => ({ Month: m.label, Created: m.created, "Value (₹)": m.value, Closed: m.closed })),
    },
    { name: "By status", rows: data.by_status.map((s) => ({ Status: s.status, Orders: s.count, "Value (₹)": s.value })) },
    {
      name: "Open by stage",
      rows: data.stages.map((s) => ({
        Stage: s.stage,
        Orders: s.count,
        "Value (₹)": s.value,
        [`Over ${OVERDUE_DAYS} days`]: s.overdue,
        ...Object.fromEntries(labels.map((l) => [`${l} days`, s.buckets[l]])),
      })),
    },
    {
      name: "Stuck longest",
      rows: rank(stuck, "days").map((s) => ({
        Order: s.order_no,
        Client: s.client_name,
        CSM: s.creator_name,
        Status: s.status,
        Stage: s.stage,
        "Working days in stage": s.days,
        "Value (₹)": s.value,
      })),
    },
    {
      name: "Clients",
      rows: clients.map((c) => ({
        Client: c.client_name,
        Orders: c.orders,
        Closed: c.closed,
        "Value (₹)": c.value,
        "Share (%)": c.share,
      })),
    },
    {
      name: "Media",
      rows: rank([...mediaMap.values()], "amount").map((m) => ({
        Media: m.media,
        Lines: m.lines,
        Qty: m.qty,
        Sft: m.sft,
        "Amount (₹)": m.amount,
      })),
    },
    {
      name: "Store locations",
      rows: rank([...locationMap].map(([Location, Stores]) => ({ Location, Stores })), "Stores"),
    },
    {
      name: "Waiting for CSM",
      rows: waitingRows.map((w) => ({
        Order: w.order_no,
        Client: w.client_name,
        CSM: w.creator_name,
        Allotted: istDay(w.created_at),
        "Days waiting": w.days,
      })),
    },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------

async function moneyReport(r: ReportRange, f: Filters): Promise<Built> {
  const base = orderWhere(f);
  const orderSelect = { select: { id: true, order_no: true, client_name: true, creator_name: true, status: true } };
  const [invoices, unbilledStores, pendingOrders, lossItems, adjustedItems, orderAdjustments, paidOut] = await Promise.all([
    prisma.invoice.findMany({ where: { order: base }, include: { order: orderSelect } }),
    prisma.orderStore.findMany({
      where: { installed_at: { not: null }, invoice_id: null, order: { ...base, status: { in: OPEN_STATUSES } } },
      include: { items: true, adjustments: { where: { status: "Approved" } }, order: orderSelect },
    }),
    prisma.order.findMany({ where: { ...base, status: "Pending" }, include: ORDER_INCLUDE }),
    prisma.orderItem.findMany({
      where: {
        remarks: { in: [...LOSS_REMARKS] as any },
        remarks_confirmed: true,
        remarks_set_at: { gte: r.start, lt: r.end },
        order: base,
      },
      select: { remarks: true, amount: true },
    }),
    prisma.orderItem.findMany({
      where: {
        remarks: { in: [...ADJUSTMENT_REMARKS] as any },
        remarks_confirmed: true,
        remarks_confirmed_at: { gte: r.start, lt: r.end },
        order: base,
      },
    }),
    prisma.orderAdjustment.findMany({ where: { status: "Approved", decided_at: { gte: r.start, lt: r.end }, order: base } }),
    prisma.paymentRequest.findMany({
      where: { status: { in: ["PAID", "CLOSED"] }, paid_at: { gte: r.start, lt: r.end }, order: base },
      select: { amount: true, paid_amount: true },
    }),
  ]);

  type Inv = (typeof invoices)[number];
  const billedAt = (i: Inv) => i.billing_date ?? i.created_at;
  const due = (i: Inv) => round2(num(i.bill_amount) - num(i.amount_received));

  const billed = invoices.filter((i) => inRange(billedAt(i), r));
  const received = invoices.filter((i) => i.amount_received != null && inRange(i.payment_received_at, r));
  // An order an admin closed by hand is finished: what it still shows as due is written off.
  const outstanding = invoices.filter((i) => i.order.status !== "Completed" && due(i) > 0.005);
  const writtenOff = invoices.filter((i) => i.order.status === "Completed" && due(i) > 0.005);

  const followUps = outstanding.length
    ? await prisma.paymentFollowUp.groupBy({
        by: ["order_id"],
        where: { order_id: { in: [...new Set(outstanding.map((i) => i.order_id))] } },
        _max: { created_at: true },
        _count: { _all: true },
      })
    : [];
  const lastFollowUp = new Map(followUps.map((x) => [x.order_id, { at: x._max.created_at, count: x._count._all }]));

  const labels = bucketLabels(AGING_EDGES);
  const aging = new Map(labels.map((l) => [l, { bucket: l, invoices: 0, due: 0 }]));
  for (const i of outstanding) {
    const row = aging.get(ageBucket(calendarDays(billedAt(i)), AGING_EDGES))!;
    row.invoices += 1;
    row.due = round2(row.due + due(i));
  }

  const clientDue = new Map<string, { client_name: string; invoices: number; due: number }>();
  for (const i of outstanding) {
    const row = clientDue.get(i.order.client_name) ?? { client_name: i.order.client_name, invoices: 0, due: 0 };
    row.invoices += 1;
    row.due = round2(row.due + due(i));
    clientDue.set(i.order.client_name, row);
  }

  const months = monthsOf(r);
  const byMonth = new Map(months.map((m) => [m, { month: m, label: monthLabel(m), billed: 0, received: 0 }]));
  for (const i of billed) {
    const row = byMonth.get(istMonth(billedAt(i)));
    if (row) row.billed = round2(row.billed + num(i.bill_amount));
  }
  for (const i of received) {
    const row = byMonth.get(istMonth(i.payment_received_at!));
    if (row) row.received = round2(row.received + num(i.amount_received));
  }

  const unbilled = unbilledStores
    .map((s) => ({
      order_id: s.order.id,
      order_no: s.order.order_no,
      client_name: s.order.client_name,
      creator_name: s.order.creator_name,
      store_name: s.store_name,
      installed_at: s.installed_at,
      days: calendarDays(s.installed_at!),
      value: computeTotals(s.items, s.adjustments).total_amount,
    }))
    .sort((a, b) => b.days - a.days);

  const shortBilled = pendingOrders
    .map((o) => {
      const expected = computeTotals(o.items, o.adjustments).total_amount;
      const receivedSum = sum(o.invoices, (i) => num(i.amount_received));
      return {
        order_id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        creator_name: o.creator_name,
        expected,
        billed: sum(o.invoices, (i) => num(i.bill_amount)),
        received: receivedSum,
        gap: round2(expected - receivedSum),
      };
    })
    .filter((o) => o.gap > 0.005)
    .sort((a, b) => b.gap - a.gap);

  const lossByReason = new Map<string, number>();
  for (const i of lossItems) tally(lossByReason, String(i.remarks), num(i.amount));
  const adjByType = new Map<string, number>();
  for (const i of adjustedItems) tally(adjByType, String(i.remarks), itemAdjustment(i));
  for (const a of orderAdjustments) tally(adjByType, String(a.type), orderAdjustmentValue(a));

  const collectionDays = received.map((i) => calendarDays(billedAt(i), i.payment_received_at!));

  const kpis = {
    billed: sum(billed, (i) => num(i.bill_amount)),
    invoices_raised: billed.length,
    received: sum(received, (i) => num(i.amount_received)),
    payments: received.length,
    outstanding: sum(outstanding, due),
    outstanding_invoices: outstanding.length,
    overdue_90: aging.get(labels[labels.length - 1]!)!.due,
    avg_collection_days: mean1(collectionDays),
    unbilled_value: sum(unbilled, (u) => u.value),
    unbilled_stores: unbilled.length,
    short_billed: sum(shortBilled, (o) => o.gap),
    written_off: sum(writtenOff, due),
    loss: round2([...lossByReason.values()].reduce((s, v) => s + v, 0)),
    net_adjustment: round2([...adjByType.values()].reduce((s, v) => s + v, 0)),
    paid_out: sum(paidOut, (p) => num(p.paid_amount ?? p.amount)),
  };

  const dueRows = outstanding
    .map((i) => ({
      order_id: i.order.id,
      order_no: i.order.order_no,
      client_name: i.order.client_name,
      creator_name: i.order.creator_name,
      invoice_no: i.invoice_no,
      billed_on: billedAt(i),
      days: calendarDays(billedAt(i)),
      bill_amount: num(i.bill_amount),
      received: num(i.amount_received),
      due: due(i),
      follow_ups: lastFollowUp.get(i.order_id)?.count ?? 0,
      last_follow_up: lastFollowUp.get(i.order_id)?.at ?? null,
    }))
    .sort((a, b) => b.due - a.due);

  const data = {
    kpis,
    by_month: [...byMonth.values()],
    aging: [...aging.values()],
    clients: rank([...clientDue.values()], "due", 15),
    outstanding: dueRows.slice(0, 100),
    unbilled: unbilled.slice(0, 100),
    short_billed: shortBilled.slice(0, 100),
    loss_by_reason: rank([...lossByReason].map(([reason, amount]) => ({ reason, amount: round2(amount) })), "amount"),
    adjustments_by_type: [...adjByType].map(([type, amount]) => ({ type, amount: round2(amount) })),
  };

  const sheets: Sheet[] = [
    summarySheet(r, f, [
      ["Billed in range (₹)", kpis.billed],
      ["Invoices raised", kpis.invoices_raised],
      ["Received in range (₹)", kpis.received],
      ["Payments received", kpis.payments],
      ["Outstanding now (₹)", kpis.outstanding],
      ["Outstanding invoices", kpis.outstanding_invoices],
      ["Due for 90+ days (₹)", kpis.overdue_90],
      ["Average days to collect", kpis.avg_collection_days],
      ["Installed, not billed (₹)", kpis.unbilled_value],
      ["Billed or paid short (₹)", kpis.short_billed],
      ["Written off on closure (₹)", kpis.written_off],
      ["Loss in range (₹)", kpis.loss],
      ["Net adjustments in range (₹)", kpis.net_adjustment],
      ["Paid out on payment requests (₹)", kpis.paid_out],
    ]),
    {
      name: "By month",
      rows: data.by_month.map((m) => ({ Month: m.label, "Billed (₹)": m.billed, "Received (₹)": m.received })),
    },
    { name: "Ageing", rows: data.aging.map((a) => ({ "Days since billing": a.bucket, Invoices: a.invoices, "Due (₹)": a.due })) },
    {
      name: "Outstanding",
      rows: dueRows.map((d) => ({
        Order: d.order_no,
        Client: d.client_name,
        CSM: d.creator_name,
        Invoice: d.invoice_no,
        "Billed on": istDay(d.billed_on),
        Days: d.days,
        "Billed (₹)": d.bill_amount,
        "Received (₹)": d.received,
        "Due (₹)": d.due,
        "Follow-ups": d.follow_ups,
        "Last follow-up": d.last_follow_up ? istDay(d.last_follow_up) : "",
      })),
    },
    {
      name: "Installed not billed",
      rows: unbilled.map((u) => ({
        Order: u.order_no,
        Client: u.client_name,
        CSM: u.creator_name,
        Store: u.store_name,
        Installed: istDay(u.installed_at!),
        Days: u.days,
        "Value (₹)": u.value,
      })),
    },
    {
      name: "Short billed",
      rows: shortBilled.map((o) => ({
        Order: o.order_no,
        Client: o.client_name,
        CSM: o.creator_name,
        "Expected (₹)": o.expected,
        "Billed (₹)": o.billed,
        "Received (₹)": o.received,
        "Gap (₹)": o.gap,
      })),
    },
    {
      name: "Loss and adjustments",
      rows: [
        ...data.loss_by_reason.map((l) => ({ Kind: "Loss", Remark: l.reason, "Amount (₹)": l.amount })),
        ...data.adjustments_by_type.map((a) => ({ Kind: "Adjustment", Remark: a.type, "Amount (₹)": a.amount })),
      ],
    },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// CSM performance
// ---------------------------------------------------------------------------------------

async function csmReport(r: ReportRange, f: Filters): Promise<Built> {
  const clientOnly = f.client ? { client_name: f.client } : {};
  const [csms, created, open, invoices, jobs, requests] = await Promise.all([
    prisma.user.findMany({ where: { role: "CSM" }, select: { id: true, name: true, role: true, is_active: true, deleted_at: true } }),
    prisma.order.findMany({ where: { ...clientOnly, created_at: { gte: r.start, lt: r.end } }, include: ORDER_INCLUDE }),
    prisma.order.findMany({ where: { ...clientOnly, status: { in: OPEN_STATUSES } }, include: ORDER_INCLUDE }),
    prisma.invoice.findMany({
      where: { order: { ...clientOnly, status: { not: "Completed" } } },
      select: { bill_amount: true, amount_received: true, order: { select: { created_by: true } } },
    }),
    prisma.workJob.findMany({
      where: { start_date: { lte: r.dateTo }, end_date: { gte: r.dateFrom } },
      select: {
        status: true,
        csm_user_id: true,
        csmCode: { select: { user_id: true } },
        csm2Code: { select: { user_id: true } },
      },
    }),
    prisma.paymentRequest.findMany({
      where: { created_at: { gte: r.start, lt: r.end } },
      select: { requested_by: true, amount: true, paid_amount: true, status: true },
    }),
  ]);

  // Orders an admin or OM created themselves show under that person, so nothing drops out.
  const csmIds = new Set(csms.map((c) => c.id));
  const creators = new Set<number>([...created, ...open].map((o) => o.created_by).filter((x): x is number => x != null));
  const others = await prisma.user.findMany({
    where: { id: { in: [...creators].filter((id) => !csmIds.has(id)) } },
    select: { id: true, name: true, role: true, is_active: true, deleted_at: true },
  });
  const people = [...csms, ...others];

  const rows = people.map((u) => {
    const mine = created.filter((o) => o.created_by === u.id);
    const mineOpen = open.filter((o) => o.created_by === u.id);
    const t = mine.map((o) => computeTotals(o.items, o.adjustments));
    const value = sum(t, (x) => x.total_amount);
    const loss = sum(t, (x) => x.loss_amount);
    const closedMine = mine.filter((o) => (CLOSED_STATUSES as string[]).includes(o.status));
    const myJobs = jobs.filter(
      (j) => j.csm_user_id === u.id || j.csmCode?.user_id === u.id || j.csm2Code?.user_id === u.id,
    );
    const myRequests = requests.filter((p) => p.requested_by === u.id);
    return {
      user_id: u.id,
      name: u.name,
      role: u.role,
      active: u.is_active && !u.deleted_at,
      orders: mine.length,
      value,
      avg_value: mine.length ? round2(value / mine.length) : null,
      closed: closedMine.length,
      closure_rate: pct(closedMine.length, mine.length),
      avg_cycle_days: averageCycleDays(closedMine),
      loss,
      loss_pct: pct(loss, value + loss),
      net_adjustment: sum(t, (x) => x.adjustment_amount),
      open_now: mineOpen.length,
      waiting_now: mineOpen.filter(isWaiting).length,
      overdue_now: mineOpen.filter((o) => (currentStage(o)?.days_in_stage ?? 0) > OVERDUE_DAYS).length,
      outstanding: sum(
        invoices.filter((i) => i.order.created_by === u.id),
        (i) => Math.max(0, num(i.bill_amount) - num(i.amount_received)),
      ),
      jobs: myJobs.length,
      jobs_completed: myJobs.filter((j) => j.status === "COMPLETED").length,
      requests: myRequests.length,
      requested: sum(myRequests, (p) => num(p.amount)),
      paid: sum(myRequests, (p) => num(p.paid_amount)),
    };
  });
  // People with nothing in the range and nothing open are noise; a current CSM still shows.
  const shown = rank(
    rows.filter((x) => x.orders || x.open_now || x.jobs || x.requests || (x.role === "CSM" && x.active)),
    "value",
  );

  const data = {
    kpis: {
      people: shown.filter((x) => x.orders > 0).length,
      orders: sum(shown, (x) => x.orders),
      value: sum(shown, (x) => x.value),
      overdue_now: sum(shown, (x) => x.overdue_now),
      waiting_now: sum(shown, (x) => x.waiting_now),
      outstanding: sum(shown, (x) => x.outstanding),
    },
    overdue_days: OVERDUE_DAYS,
    rows: shown,
  };
  const sheets: Sheet[] = [
    summarySheet(r, f, [
      ["People with orders", data.kpis.people],
      ["Orders", data.kpis.orders],
      ["Value (₹)", data.kpis.value],
      ["Overdue orders now", data.kpis.overdue_now],
      ["Waiting for stores now", data.kpis.waiting_now],
      ["Outstanding (₹)", data.kpis.outstanding],
    ]),
    {
      name: "CSMs",
      rows: shown.map((x) => ({
        Name: x.name,
        Role: x.role,
        Active: x.active ? "Yes" : "No",
        Orders: x.orders,
        "Value (₹)": x.value,
        "Average order (₹)": x.avg_value,
        Closed: x.closed,
        "Closure rate (%)": x.closure_rate,
        "Average cycle (working days)": x.avg_cycle_days,
        "Loss (₹)": x.loss,
        "Loss (%)": x.loss_pct,
        "Net adjustments (₹)": x.net_adjustment,
        "Open now": x.open_now,
        "Waiting for stores": x.waiting_now,
        [`Overdue (>${OVERDUE_DAYS} days)`]: x.overdue_now,
        "Outstanding (₹)": x.outstanding,
        "Field jobs": x.jobs,
        "Jobs completed": x.jobs_completed,
        "Payment requests": x.requests,
        "Requested (₹)": x.requested,
        "Paid (₹)": x.paid,
      })),
    },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------------------

async function productionReport(r: ReportRange): Promise<Built> {
  const [assignments, flagged, unassigned] = await Promise.all([
    prisma.orderItemAssignment.findMany({
      where: {
        OR: [
          { assigned_at: { gte: r.start, lt: r.end } },
          { completed_at: { gte: r.start, lt: r.end } },
          { completed: false, orderItem: { order: { status: { in: OPEN_STATUSES } } } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
        orderItem: { select: { total_sft: true } },
      },
    }),
    prisma.orderItem.findMany({
      where: { is_flagged: true, production_completed: false, order: { status: { in: OPEN_STATUSES } } },
      include: { order: { select: { id: true, order_no: true, client_name: true } }, flagger: { select: { name: true } } },
      orderBy: { flagged_at: "asc" },
    }),
    prisma.orderItem.findMany({
      where: { production_completed: false, assignments: { none: {} }, order: { status: "Active" } },
      select: {
        total_sft: true,
        order: { select: { id: true, order_no: true, client_name: true, created_at: true, creator_name: true } },
      },
    }),
  ]);

  const months = monthsOf(r);
  const byMonth = new Map(months.map((m) => [m, { month: m, label: monthLabel(m), assigned: 0, completed: 0, sft: 0 }]));
  const people = new Map<number, any>();
  const finishDays: number[] = [];
  for (const a of assignments) {
    const p =
      people.get(a.user_id) ??
      { user_id: a.user_id, name: a.user.name, role: a.user.role, assigned: 0, completed: 0, sft: 0, open_now: 0, days: [] as number[] };
    if (inRange(a.assigned_at, r)) {
      p.assigned += 1;
      const m = byMonth.get(istMonth(a.assigned_at));
      if (m) m.assigned += 1;
    }
    if (a.completed && a.completed_at && inRange(a.completed_at, r)) {
      p.completed += 1;
      p.sft = round2(p.sft + num(a.orderItem.total_sft));
      const d = businessDaysBetween(a.assigned_at, a.completed_at);
      p.days.push(d);
      finishDays.push(d);
      const m = byMonth.get(istMonth(a.completed_at));
      if (m) {
        m.completed += 1;
        m.sft = round2(m.sft + num(a.orderItem.total_sft));
      }
    }
    if (!a.completed) p.open_now += 1;
    people.set(a.user_id, p);
  }
  const rows = rank(
    [...people.values()].map(({ days, ...p }) => ({ ...p, avg_days: mean1(days) })),
    "completed",
  );

  const waitingOrders = new Map<number, any>();
  for (const i of unassigned) {
    const o =
      waitingOrders.get(i.order.id) ??
      {
        order_id: i.order.id,
        order_no: i.order.order_no,
        client_name: i.order.client_name,
        creator_name: i.order.creator_name,
        items: 0,
        sft: 0,
        days: calendarDays(i.order.created_at),
      };
    o.items += 1;
    o.sft = round2(o.sft + num(i.total_sft));
    waitingOrders.set(i.order.id, o);
  }
  const holds = flagged.map((i) => ({
    order_id: i.order.id,
    order_no: i.order.order_no,
    client_name: i.order.client_name,
    media: i.media,
    reason: i.flag_reason,
    flagged_by: i.flagger?.name ?? null,
    flagged_at: i.flagged_at,
    days: i.flagged_at ? calendarDays(i.flagged_at) : null,
  }));

  const kpis = {
    assigned: sum(rows, (x) => x.assigned),
    completed: sum(rows, (x) => x.completed),
    sft: sum(rows, (x) => x.sft),
    open_now: sum(rows, (x) => x.open_now),
    avg_days: mean1(finishDays),
    on_hold: holds.length,
    unassigned_items: unassigned.length,
    unassigned_sft: sum(unassigned, (i) => num(i.total_sft)),
  };
  const data = {
    kpis,
    by_month: [...byMonth.values()],
    people: rows,
    holds,
    unassigned: rank([...waitingOrders.values()], "days", 50),
  };
  const sheets: Sheet[] = [
    summarySheet(r, {}, [
      ["Items assigned", kpis.assigned],
      ["Items completed", kpis.completed],
      ["Sft completed", kpis.sft],
      ["Open assignments now", kpis.open_now],
      ["Average working days to finish", kpis.avg_days],
      ["Items on hold now", kpis.on_hold],
      ["Items not assigned yet", kpis.unassigned_items],
      ["Sft not assigned yet", kpis.unassigned_sft],
    ]),
    {
      name: "By month",
      rows: data.by_month.map((m) => ({ Month: m.label, Assigned: m.assigned, Completed: m.completed, Sft: m.sft })),
    },
    {
      name: "People",
      rows: rows.map((p) => ({
        Name: p.name,
        Role: p.role,
        Assigned: p.assigned,
        Completed: p.completed,
        "Sft done": p.sft,
        "Open now": p.open_now,
        "Average working days": p.avg_days,
      })),
    },
    {
      name: "On hold",
      rows: holds.map((h) => ({
        Order: h.order_no,
        Client: h.client_name,
        Media: h.media,
        Reason: h.reason ?? "",
        "Flagged by": h.flagged_by ?? "",
        Flagged: h.flagged_at ? istDay(h.flagged_at) : "",
        Days: h.days,
      })),
    },
    {
      name: "Not assigned",
      rows: rank([...waitingOrders.values()], "days").map((o) => ({
        Order: o.order_no,
        Client: o.client_name,
        CSM: o.creator_name,
        Items: o.items,
        Sft: o.sft,
        "Days since created": o.days,
      })),
    },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// Field work (Work Allocation)
// ---------------------------------------------------------------------------------------

const FIELD_ROLES: Role[] = ["PASTER", "HELPER", "DRIVER"];
const DAY_MS = 86_400_000;

async function allocationReport(r: ReportRange): Promise<Built> {
  const overlap = { start_date: { lte: r.dateTo }, end_date: { gte: r.dateFrom } };
  const [jobs, staff, leave, overtime, paid] = await Promise.all([
    prisma.workJob.findMany({
      where: overlap,
      include: {
        members: { select: { user_id: true, start_date: true, end_date: true } },
        area: { select: { name: true, locality: true, district: true } },
        vehicle: { select: { reg_no: true, type: true } },
        csmCode: { select: { code: true } },
        csm2Code: { select: { code: true } },
        order: { select: { id: true, order_no: true, client_name: true } },
        csmUser: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: FIELD_ROLES }, deleted_at: null },
      select: { id: true, name: true, role: true, is_active: true, emp_code: true },
      orderBy: { name: "asc" },
    }),
    prisma.leaveRecord.findMany({
      where: { from_date: { lte: r.dateTo }, to_date: { gte: r.dateFrom }, cancelled_at: null },
      select: { user_id: true, from_date: true, to_date: true, status: true },
    }),
    prisma.overtimeEntry.findMany({
      where: { work_date: { gte: r.dateFrom, lte: r.dateTo } },
      select: { user_id: true, minutes: true, status: true },
    }),
    prisma.paymentRequest.findMany({
      where: { paid_at: { gte: r.start, lt: r.end }, status: { in: ["PAID", "CLOSED"] } },
      select: { requested_by: true, amount: true, paid_amount: true },
    }),
  ]);

  const live = jobs.filter((j) => j.status !== "CANCELLED");
  const days = (j: { start_date: Date; end_date: Date }) => overlapDays(j.start_date, j.end_date, r.dateFrom, r.dateTo);
  const today = new Date(`${todayIst()}T00:00:00Z`);

  const statusCount = new Map<string, number>();
  for (const j of jobs) tally(statusCount, j.status);

  // Day by day for up to two months, else month by month.
  const dayKeys = daysOf(r);
  const daily = dayKeys.length <= 62;
  const timeline = new Map(
    (daily ? dayKeys : monthsOf(r)).map((k) => [k, { key: k, label: daily ? k.slice(5) : monthLabel(k), jobs: 0, people: 0 }]),
  );
  for (const j of live) {
    const first = Math.max(j.start_date.getTime(), r.dateFrom.getTime());
    const last = Math.min(j.end_date.getTime(), r.dateTo.getTime());
    for (let t = first; t <= last; t += DAY_MS) {
      const day = new Date(t).toISOString().slice(0, 10);
      const row = timeline.get(daily ? day : day.slice(0, 7));
      if (!row) continue;
      row.jobs += 1;
      row.people += j.members.filter((m) => m.start_date.getTime() <= t && m.end_date.getTime() >= t).length;
    }
  }

  const locality = new Map<string, { locality: string; jobs: number; days: number }>();
  const areas = new Map<string, { area: string; locality: string; district: string; jobs: number; days: number }>();
  const districts = new Map<string, { district: string; jobs: number; days: number }>();
  const vehicles = new Map<string, { reg_no: string; type: string; jobs: number; days: number }>();
  const codes = new Map<string, { code: string; jobs: number; days: number }>();
  const add = <T extends { jobs: number; days: number }>(m: Map<string, T>, k: string, init: () => T, d: number) => {
    const x = m.get(k) ?? init();
    x.jobs += 1;
    x.days += d;
    m.set(k, x);
  };
  for (const j of live) {
    const d = days(j);
    const loc = j.locality ?? j.area?.locality ?? "UNSET";
    add(locality, loc, () => ({ locality: loc, jobs: 0, days: 0 }), d);
    const areaName = j.area?.name ?? "(no area)";
    add(areas, areaName, () => ({ area: areaName, locality: loc, district: j.area?.district ?? "", jobs: 0, days: 0 }), d);
    if (loc === "NON_LOCAL") {
      const name = j.area?.district || "(no district)";
      add(districts, name, () => ({ district: name, jobs: 0, days: 0 }), d);
    }
    if (j.vehicle) {
      const v = j.vehicle;
      add(vehicles, v.reg_no, () => ({ reg_no: v.reg_no, type: v.type, jobs: 0, days: 0 }), d);
    }
    for (const c of [j.csmCode?.code, j.csm2Code?.code]) {
      if (c) add(codes, c, () => ({ code: c, jobs: 0, days: 0 }), d);
    }
  }

  const working = workingDaysIn(r);
  const staffRows = staff.map((u) => {
    const slots = live.flatMap((j) => j.members.filter((m) => m.user_id === u.id));
    const jobDays = slots.reduce((s, m) => s + overlapDays(m.start_date, m.end_date, r.dateFrom, r.dateTo), 0);
    const jobWorking = slots.reduce((s, m) => s + overlapDays(m.start_date, m.end_date, r.dateFrom, r.dateTo, true), 0);
    const myLeave = leave.filter((l) => l.user_id === u.id && l.status === "APPROVED");
    const leaveDays = myLeave.reduce((s, l) => s + overlapDays(l.from_date, l.to_date, r.dateFrom, r.dateTo), 0);
    const leaveWorking = myLeave.reduce((s, l) => s + overlapDays(l.from_date, l.to_date, r.dateFrom, r.dateTo, true), 0);
    const available = Math.max(0, working - leaveWorking);
    const ot = overtime.filter((o) => o.user_id === u.id);
    return {
      user_id: u.id,
      name: u.name,
      role: u.role,
      emp_code: u.emp_code,
      active: u.is_active,
      jobs: slots.length,
      job_days: jobDays,
      leave_days: leaveDays,
      available_days: available,
      idle_days: Math.max(0, available - jobWorking),
      utilisation: available > 0 ? Math.min(100, Math.round((jobWorking / available) * 100)) : null,
      ot_hours: round1(ot.filter((o) => o.status === "APPROVED").reduce((s, o) => s + o.minutes, 0) / 60),
      ot_pending_hours: round1(ot.filter((o) => o.status === "PENDING").reduce((s, o) => s + o.minutes, 0) / 60),
      paid: sum(paid.filter((p) => p.requested_by === u.id), (p) => num(p.paid_amount ?? p.amount)),
    };
  });

  const attention: any[] = [];
  const jobRef = (j: (typeof jobs)[number]) => ({
    job_id: j.id,
    order_id: j.order?.id ?? null,
    order_no: j.order?.order_no ?? j.job_no ?? `Job ${j.id}`,
    client_name: j.order?.client_name ?? "",
    csm: j.csmUser?.name ?? j.csmCode?.code ?? "",
    area: j.area?.name ?? "",
    start_date: istDay(j.start_date),
    end_date: istDay(j.end_date),
    status: j.status,
  });
  for (const j of jobs) {
    if (j.status === "CANCELLED") {
      attention.push({ ...jobRef(j), issue: "Cancelled", note: j.cancel_reason ?? "" });
      continue;
    }
    if (j.status === "HOLD") attention.push({ ...jobRef(j), issue: "On hold", note: j.instructions ?? "" });
    if (!j.order_id) attention.push({ ...jobRef(j), issue: "No order linked", note: "" });
    if (j.members.length === 0) attention.push({ ...jobRef(j), issue: "Nobody on it", note: "" });
    if (j.status === "ASSIGNED" && j.start_date.getTime() < today.getTime())
      attention.push({ ...jobRef(j), issue: "Not started", note: `Was due ${istDay(j.start_date)}` });
    if ((j.locality ?? j.area?.locality) == null) attention.push({ ...jobRef(j), issue: "Local or not unset", note: "" });
  }

  const leaveByStatus = new Map<string, { status: string; records: number; days: number }>();
  for (const l of leave) {
    const x = leaveByStatus.get(l.status) ?? { status: l.status, records: 0, days: 0 };
    x.records += 1;
    x.days += overlapDays(l.from_date, l.to_date, r.dateFrom, r.dateTo);
    leaveByStatus.set(l.status, x);
  }
  const otByStatus = new Map<string, { status: string; entries: number; hours: number }>();
  for (const o of overtime) {
    const x = otByStatus.get(o.status) ?? { status: o.status, entries: 0, hours: 0 };
    x.entries += 1;
    x.hours = round1(x.hours + o.minutes / 60);
    otByStatus.set(o.status, x);
  }

  const activeStaff = staffRows.filter((s) => s.active);
  const kpis = {
    jobs: jobs.length,
    live_jobs: live.length,
    completed: statusCount.get("COMPLETED") ?? 0,
    cancelled: statusCount.get("CANCELLED") ?? 0,
    on_hold: statusCount.get("HOLD") ?? 0,
    job_days: live.reduce((s, j) => s + days(j), 0),
    person_days: staffRows.reduce((s, x) => s + x.job_days, 0),
    working_days: working,
    staff: activeStaff.length,
    avg_utilisation: mean1(activeStaff.map((s) => s.utilisation).filter((x): x is number => x != null)),
    leave_days: leaveByStatus.get("APPROVED")?.days ?? 0,
    ot_hours: otByStatus.get("APPROVED")?.hours ?? 0,
    ot_pending_hours: otByStatus.get("PENDING")?.hours ?? 0,
    attention: attention.length,
  };
  const data = {
    kpis,
    by_status: [...statusCount].map(([status, count]) => ({ status, count })),
    timeline: { daily, rows: [...timeline.values()] },
    locality: [...locality.values()],
    areas: rank([...areas.values()], "days", 15),
    districts: rank([...districts.values()], "days", 15),
    vehicles: rank([...vehicles.values()], "days"),
    codes: rank([...codes.values()], "jobs", 20),
    staff: rank(staffRows, "job_days"),
    attention,
    leave: [...leaveByStatus.values()],
    overtime: [...otByStatus.values()],
  };
  const sheets: Sheet[] = [
    summarySheet(r, {}, [
      ["Jobs in range", kpis.jobs],
      ["Jobs not cancelled", kpis.live_jobs],
      ["Completed", kpis.completed],
      ["Cancelled", kpis.cancelled],
      ["On hold", kpis.on_hold],
      ["Job-days", kpis.job_days],
      ["Person-days booked", kpis.person_days],
      ["Working days (Mon–Sat)", kpis.working_days],
      ["Active field staff", kpis.staff],
      ["Average utilisation (%)", kpis.avg_utilisation],
      ["Approved leave days", kpis.leave_days],
      ["Approved overtime hours", kpis.ot_hours],
      ["Overtime hours waiting", kpis.ot_pending_hours],
      ["Jobs needing attention", kpis.attention],
    ]),
    {
      name: "Field staff",
      rows: data.staff.map((s) => ({
        Name: s.name,
        Role: s.role,
        "Emp code": s.emp_code ?? "",
        Active: s.active ? "Yes" : "No",
        Jobs: s.jobs,
        "Days on jobs": s.job_days,
        "Leave days": s.leave_days,
        "Available days": s.available_days,
        "Idle days": s.idle_days,
        "Utilisation (%)": s.utilisation,
        "Overtime hours": s.ot_hours,
        "Overtime waiting (h)": s.ot_pending_hours,
        "Paid on requests (₹)": s.paid,
      })),
    },
    {
      name: daily ? "By day" : "By month",
      rows: data.timeline.rows.map((t) => ({ When: t.key, Jobs: t.jobs, People: t.people })),
    },
    {
      name: "Areas",
      rows: rank([...areas.values()], "days").map((a) => ({ Area: a.area, Locality: a.locality, District: a.district, Jobs: a.jobs, Days: a.days })),
    },
    { name: "Districts", rows: rank([...districts.values()], "days").map((d) => ({ District: d.district, Jobs: d.jobs, Days: d.days })) },
    { name: "Vehicles", rows: data.vehicles.map((v) => ({ Vehicle: v.reg_no, Type: v.type, Jobs: v.jobs, Days: v.days })) },
    { name: "CSM codes", rows: rank([...codes.values()], "jobs").map((c) => ({ Code: c.code, Jobs: c.jobs, Days: c.days })) },
    {
      name: "Needs attention",
      rows: attention.map((a) => ({
        Issue: a.issue,
        Order: a.order_no,
        Client: a.client_name,
        CSM: a.csm,
        Area: a.area,
        From: a.start_date,
        To: a.end_date,
        Status: a.status,
        Note: a.note,
      })),
    },
    {
      name: "Leave and overtime",
      rows: [
        ...data.leave.map((l) => ({ Kind: "Leave", Status: l.status, Records: l.records, "Days or hours": l.days })),
        ...data.overtime.map((o) => ({ Kind: "Overtime", Status: o.status, Records: o.entries, "Days or hours": o.hours })),
      ],
    },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// Payment requests
// ---------------------------------------------------------------------------------------

async function paymentsReport(r: ReportRange, f: Filters): Promise<Built> {
  const base = orderWhere(f);
  const requests = await prisma.paymentRequest.findMany({
    where: {
      order: base,
      OR: [
        { created_at: { gte: r.start, lt: r.end } },
        { paid_at: { gte: r.start, lt: r.end } },
        { status: { in: OPEN_PAYMENT_STATUSES } },
      ],
    },
    include: {
      requester: { select: { id: true, name: true, role: true } },
      order: { select: { id: true, order_no: true, client_name: true } },
    },
  });
  type Req = (typeof requests)[number];
  const created = requests.filter((p) => inRange(p.created_at, r));
  const paid = requests.filter((p) => p.paid_at && inRange(p.paid_at, r));
  const openNow = requests.filter((p) => (OPEN_PAYMENT_STATUSES as string[]).includes(p.status));
  const paidValue = (p: Req) => num(p.paid_amount ?? p.amount);

  const group = (key: (p: Req) => string) => {
    const m = new Map<string, { key: string; count: number; amount: number }>();
    for (const p of created) {
      const k = key(p);
      const x = m.get(k) ?? { key: k, count: 0, amount: 0 };
      x.count += 1;
      x.amount = round2(x.amount + num(p.amount));
      m.set(k, x);
    }
    return rank([...m.values()], "amount");
  };

  const months = monthsOf(r);
  const byMonth = new Map(months.map((m) => [m, { month: m, label: monthLabel(m), requested: 0, paid: 0 }]));
  for (const p of created) {
    const x = byMonth.get(istMonth(p.created_at));
    if (x) x.requested = round2(x.requested + num(p.amount));
  }
  for (const p of paid) {
    const x = byMonth.get(istMonth(p.paid_at!));
    if (x) x.paid = round2(x.paid + paidValue(p));
  }

  const people = new Map<number, { user_id: number; name: string; role: string; requests: number; requested: number; paid: number }>();
  const person = (p: Req) => {
    const x = people.get(p.requested_by) ?? { user_id: p.requested_by, name: p.requester.name, role: p.requester.role, requests: 0, requested: 0, paid: 0 };
    people.set(p.requested_by, x);
    return x;
  };
  for (const p of created) {
    const x = person(p);
    x.requests += 1;
    x.requested = round2(x.requested + num(p.amount));
  }
  for (const p of paid) {
    const x = person(p);
    x.paid = round2(x.paid + paidValue(p));
  }

  const orders = new Map<number, any>();
  for (const p of paid) {
    const x =
      orders.get(p.order_id) ??
      { order_id: p.order_id, order_no: p.order.order_no, client_name: p.order.client_name, requests: 0, paid: 0, order_value: 0, cost_pct: null };
    x.requests += 1;
    x.paid = round2(x.paid + paidValue(p));
    orders.set(p.order_id, x);
  }
  const topOrders = rank([...orders.values()], "paid", 20);
  if (topOrders.length) {
    const full = await prisma.order.findMany({
      where: { id: { in: topOrders.map((o) => o.order_id) } },
      select: { id: true, items: true, adjustments: { where: { status: "Approved" } } },
    });
    const values = new Map(full.map((o) => [o.id, computeTotals(o.items, o.adjustments).total_amount]));
    for (const o of topOrders) {
      o.order_value = values.get(o.order_id) ?? 0;
      o.cost_pct = pct(o.paid, o.order_value);
    }
  }

  const openRows = openNow
    .map((p) => ({
      request_id: p.id,
      order_id: p.order_id,
      order_no: p.order.order_no,
      client_name: p.order.client_name,
      requester: p.requester.name,
      category: p.category ?? "—",
      amount: num(p.amount),
      status: p.status,
      days: calendarDays(p.status_changed_at),
    }))
    .sort((a, b) => b.days - a.days);

  const kpis = {
    requests: created.length,
    requested: sum(created, (p) => num(p.amount)),
    paid_count: paid.length,
    paid: sum(paid, paidValue),
    open: openNow.length,
    open_amount: sum(openNow, (p) => num(p.amount)),
    avg_days_to_pay: mean1(paid.map((p) => round1((p.paid_at!.getTime() - p.created_at.getTime()) / DAY_MS))),
    rejected: created.filter((p) => p.status === "REJECTED").length,
    cancelled: created.filter((p) => p.status === "CANCELLED").length,
    stuck_7: openRows.filter((p) => p.days > 7).length,
  };
  const byStatus = group((p) => p.status);
  const byCategory = group((p) => p.category ?? "UNSET");
  const byRoute = group((p) => p.route);
  const peopleRows = rank([...people.values()], "paid");
  const data = {
    kpis,
    by_month: [...byMonth.values()],
    by_status: byStatus,
    by_category: byCategory,
    by_route: byRoute,
    people: peopleRows.slice(0, 25),
    orders: topOrders,
    open: openRows.slice(0, 50),
  };
  const sheets: Sheet[] = [
    summarySheet(r, f, [
      ["Requests raised", kpis.requests],
      ["Requested (₹)", kpis.requested],
      ["Requests paid", kpis.paid_count],
      ["Paid (₹)", kpis.paid],
      ["Open now", kpis.open],
      ["Open amount (₹)", kpis.open_amount],
      ["Average days to pay", kpis.avg_days_to_pay],
      ["Rejected", kpis.rejected],
      ["Cancelled", kpis.cancelled],
      ["Open over 7 days in one step", kpis.stuck_7],
    ]),
    { name: "By month", rows: data.by_month.map((m) => ({ Month: m.label, "Requested (₹)": m.requested, "Paid (₹)": m.paid })) },
    {
      name: "Breakdown",
      rows: [
        ...byStatus.map((x) => ({ By: "Status", Value: x.key, Requests: x.count, "Amount (₹)": x.amount })),
        ...byCategory.map((x) => ({ By: "Category", Value: x.key, Requests: x.count, "Amount (₹)": x.amount })),
        ...byRoute.map((x) => ({ By: "Route", Value: x.key, Requests: x.count, "Amount (₹)": x.amount })),
      ],
    },
    {
      name: "People",
      rows: peopleRows.map((p) => ({ Name: p.name, Role: p.role, Requests: p.requests, "Requested (₹)": p.requested, "Paid (₹)": p.paid })),
    },
    {
      name: "Orders",
      rows: topOrders.map((o) => ({
        Order: o.order_no,
        Client: o.client_name,
        Requests: o.requests,
        "Paid (₹)": o.paid,
        "Order value (₹)": o.order_value,
        "Cost (% of value)": o.cost_pct,
      })),
    },
    {
      name: "Open",
      rows: openRows.map((p) => ({
        Order: p.order_no,
        Client: p.client_name,
        Requester: p.requester,
        Category: p.category,
        "Amount (₹)": p.amount,
        Status: p.status,
        "Days in this step": p.days,
      })),
    },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// Master Library
// ---------------------------------------------------------------------------------------

async function mastersReport(r: ReportRange): Promise<Built> {
  const [clients, media, areas, orderClients, recentClients, itemMedia, storeLocations, requests, codes, vehicles] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.media.findMany({ orderBy: { name: "asc" } }),
    prisma.area.findMany({ include: { _count: { select: { workJobs: true } } }, orderBy: { name: "asc" } }),
    prisma.order.groupBy({ by: ["client_name"], _count: { _all: true }, _max: { created_at: true } }),
    prisma.order.groupBy({ by: ["client_name"], where: { created_at: { gte: r.start, lt: r.end } }, _count: { _all: true } }),
    prisma.orderItem.groupBy({ by: ["media"], _count: { _all: true }, _sum: { total_sft: true } }),
    prisma.orderStore.groupBy({ by: ["location"], _count: { _all: true } }),
    prisma.masterNameRequest.findMany({
      where: { status: "PENDING" },
      include: { requester: { select: { name: true } } },
      orderBy: { created_at: "asc" },
    }),
    prisma.csmCode.findMany({
      include: { user: { select: { name: true, deleted_at: true } }, _count: { select: { jobs: true, jobsAsCsm2: true } } },
      orderBy: { code: "asc" },
    }),
    prisma.vehicle.findMany({ include: { _count: { select: { workJobs: true } } }, orderBy: { reg_no: "asc" } }),
  ]);

  const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const clientUse = new Map(orderClients.map((c) => [key(c.client_name), { orders: c._count._all, last: c._max.created_at }]));
  const clientRecent = new Map(recentClients.map((c) => [key(c.client_name), c._count._all]));
  const mediaUse = new Map(itemMedia.map((m) => [key(m.media), { lines: m._count._all, sft: num(m._sum.total_sft) }]));
  const storeUse = new Map<string, number>();
  const storeSpelling = new Map<string, string>();
  for (const s of storeLocations) {
    tally(storeUse, key(s.location), s._count._all);
    if (!storeSpelling.has(key(s.location))) storeSpelling.set(key(s.location), s.location);
  }

  const clientRows = clients.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    active: c.is_active,
    orders: clientUse.get(key(c.name))?.orders ?? 0,
    in_range: clientRecent.get(key(c.name)) ?? 0,
    last_used: clientUse.get(key(c.name))?.last ?? null,
  }));
  const mediaRows = media.map((m) => ({
    id: m.id,
    name: m.name,
    active: m.is_active,
    lines: mediaUse.get(key(m.name))?.lines ?? 0,
    sft: round2(mediaUse.get(key(m.name))?.sft ?? 0),
  }));
  const areaRows = areas.map((a) => ({
    id: a.id,
    name: a.name,
    locality: a.locality,
    district: a.district,
    active: a.is_active,
    needs_confirmation: a.needs_confirmation,
    stores: storeUse.get(key(a.name)) ?? 0,
    jobs: a._count.workJobs,
  }));
  const known = (rows: { name: string }[]) => new Set(rows.map((x) => key(x.name)));
  const clientNames = known(clients);
  const mediaNames = known(media);
  const areaNames = known(areas);
  // Names on orders that the library does not hold: old data, or typed before the library.
  const strays = [
    ...orderClients.filter((c) => !clientNames.has(key(c.client_name))).map((c) => ({ kind: "Client", name: c.client_name, uses: c._count._all })),
    ...itemMedia.filter((m) => !mediaNames.has(key(m.media))).map((m) => ({ kind: "Media", name: m.media, uses: m._count._all })),
    ...[...storeUse]
      .filter(([k]) => k && !areaNames.has(k))
      .map(([k, uses]) => ({ kind: "Location", name: storeSpelling.get(k) ?? k, uses })),
  ].sort((a, b) => b.uses - a.uses);

  const codeRows = codes.map((c) => ({
    id: c.id,
    code: c.code,
    kind: c.kind,
    label: c.label,
    user: c.user ? (c.user.deleted_at ? `${c.user.name} (deleted)` : c.user.name) : null,
    active: c.is_active,
    jobs: c._count.jobs + c._count.jobsAsCsm2,
  }));

  const kpis = {
    clients: clients.filter((c) => c.is_active).length,
    clients_archived: clients.filter((c) => !c.is_active).length,
    clients_unused: clientRows.filter((c) => c.active && c.orders === 0).length,
    clients_no_code: clientRows.filter((c) => c.active && !c.code).length,
    media: media.filter((m) => m.is_active).length,
    media_unused: mediaRows.filter((m) => m.active && m.lines === 0).length,
    locations: areas.filter((a) => a.is_active).length,
    locations_unconfirmed: areas.filter((a) => a.needs_confirmation).length,
    locations_unused: areaRows.filter((a) => a.active && a.stores === 0 && a.jobs === 0).length,
    requests_pending: requests.length,
    strays: strays.length,
    codes_unknown: codeRows.filter((c) => c.kind === "UNKNOWN").length,
    codes_unlinked: codeRows.filter((c) => c.kind === "CSM" && !c.user).length,
  };
  const pending = requests.map((q) => ({
    id: q.id,
    kind: q.kind,
    name: q.name,
    note: q.note,
    requester: q.requester?.name ?? "",
    created_at: q.created_at,
    days: calendarDays(q.created_at),
  }));
  const data = {
    kpis,
    clients: rank(clientRows, "orders"),
    media: rank(mediaRows, "lines"),
    locations: rank(areaRows, "stores"),
    strays: strays.slice(0, 100),
    requests: pending,
    codes: rank(codeRows, "jobs"),
    vehicles: rank(
      vehicles.map((v) => ({ reg_no: v.reg_no, type: v.type, active: v.is_active, jobs: v._count.workJobs })),
      "jobs",
    ),
  };
  const yes = (b: boolean) => (b ? "Yes" : "No");
  const sheets: Sheet[] = [
    summarySheet(r, {}, [
      ["Active clients", kpis.clients],
      ["Archived clients", kpis.clients_archived],
      ["Active clients never used", kpis.clients_unused],
      ["Active clients with no code", kpis.clients_no_code],
      ["Active media", kpis.media],
      ["Active media never used", kpis.media_unused],
      ["Active locations", kpis.locations],
      ["Locations to confirm", kpis.locations_unconfirmed],
      ["Active locations never used", kpis.locations_unused],
      ["Name requests waiting", kpis.requests_pending],
      ["Names used but not in the library", kpis.strays],
      ["CSM codes of unknown kind", kpis.codes_unknown],
      ["CSM-kind codes with no person", kpis.codes_unlinked],
    ]),
    {
      name: "Clients",
      rows: data.clients.map((c) => ({
        Client: c.name,
        Code: c.code ?? "",
        Active: yes(c.active),
        "Orders (all time)": c.orders,
        "Orders in range": c.in_range,
        "Last order": c.last_used ? istDay(c.last_used) : "",
      })),
    },
    { name: "Media", rows: data.media.map((m) => ({ Media: m.name, Active: yes(m.active), Lines: m.lines, Sft: m.sft })) },
    {
      name: "Locations",
      rows: data.locations.map((a) => ({
        Location: a.name,
        Locality: a.locality,
        District: a.district ?? "",
        Active: yes(a.active),
        "To confirm": yes(a.needs_confirmation),
        Stores: a.stores,
        "Field jobs": a.jobs,
      })),
    },
    { name: "Not in library", rows: strays.map((s) => ({ Kind: s.kind, Name: s.name, Uses: s.uses })) },
    {
      name: "Name requests",
      rows: pending.map((q) => ({ Kind: q.kind, Name: q.name, Note: q.note ?? "", "Asked by": q.requester, Days: q.days })),
    },
    {
      name: "CSM codes",
      rows: data.codes.map((c) => ({ Code: c.code, Kind: c.kind, Label: c.label ?? "", Person: c.user ?? "", Active: yes(c.active), Jobs: c.jobs })),
    },
    { name: "Vehicles", rows: data.vehicles.map((v) => ({ Vehicle: v.reg_no, Type: v.type, Active: yes(v.active), Jobs: v.jobs })) },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------------------

const STALE_LOGIN_DAYS = 14;

async function systemReport(r: ReportRange): Promise<Built> {
  const [wa, waProblems, users, audit] = await Promise.all([
    prisma.whatsAppMessage.groupBy({ by: ["status"], where: { created_at: { gte: r.start, lt: r.end } }, _count: { _all: true } }),
    prisma.whatsAppMessage.findMany({
      where: { created_at: { gte: r.start, lt: r.end }, status: { in: ["FAILED", "SKIPPED"] } },
      select: { event: true, status: true, error: true, created_at: true, user: { select: { name: true } } },
      orderBy: { created_at: "desc" },
      take: 500,
    }),
    prisma.user.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true, role: true, is_active: true, last_login_at: true, phone: true, whatsapp_opt_out: true },
      orderBy: { name: "asc" },
    }),
    prisma.auditLog.groupBy({ by: ["table_name"], where: { changed_at: { gte: r.start, lt: r.end } }, _count: { _all: true } }),
  ]);

  const waBy = new Map(wa.map((x) => [x.status as string, x._count._all]));
  const waTotal = wa.reduce((s, x) => s + x._count._all, 0);
  const problemEvents = new Map<string, number>();
  for (const m of waProblems) tally(problemEvents, `${m.event} · ${m.status}`);

  const active = users.filter((u) => u.is_active);
  const roles = new Map<string, number>();
  for (const u of active) tally(roles, u.role);
  const stale = active
    .filter((u) => !u.last_login_at || calendarDays(u.last_login_at) > STALE_LOGIN_DAYS)
    .map((u) => ({
      user_id: u.id,
      name: u.name,
      role: u.role,
      last_login_at: u.last_login_at,
      days: u.last_login_at ? calendarDays(u.last_login_at) : null,
    }))
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));
  const noPhone = active.filter((u) => !u.phone).map((u) => ({ user_id: u.id, name: u.name, role: u.role }));
  const delivered = (waBy.get("DELIVERED") ?? 0) + (waBy.get("READ") ?? 0);

  const kpis = {
    whatsapp: waTotal,
    whatsapp_delivered: delivered,
    whatsapp_delivery_rate: pct(delivered, waTotal - (waBy.get("LOGGED") ?? 0) - (waBy.get("SKIPPED") ?? 0)),
    whatsapp_read: waBy.get("READ") ?? 0,
    whatsapp_failed: waBy.get("FAILED") ?? 0,
    whatsapp_skipped: waBy.get("SKIPPED") ?? 0,
    users: active.length,
    stale: stale.length,
    never_logged_in: stale.filter((s) => s.days == null).length,
    no_phone: noPhone.length,
    opted_out: active.filter((u) => u.whatsapp_opt_out).length,
    changes: audit.reduce((s, x) => s + x._count._all, 0),
  };
  const data = {
    kpis,
    stale_days: STALE_LOGIN_DAYS,
    whatsapp: rank([...waBy].map(([status, count]) => ({ status, count })), "count"),
    problem_events: rank([...problemEvents].map(([event, count]) => ({ event, count })), "count", 15),
    problems: waProblems.slice(0, 30).map((m) => ({ event: m.event, status: m.status, error: m.error, user: m.user?.name ?? "", at: m.created_at })),
    roles: rank([...roles].map(([role, count]) => ({ role, count })), "count"),
    stale,
    no_phone: noPhone,
    changes: rank(audit.map((a) => ({ table: a.table_name, count: a._count._all })), "count"),
  };
  const sheets: Sheet[] = [
    summarySheet(r, {}, [
      ["WhatsApp messages", kpis.whatsapp],
      ["Delivered or read", kpis.whatsapp_delivered],
      ["Delivery rate of sent (%)", kpis.whatsapp_delivery_rate],
      ["Read", kpis.whatsapp_read],
      ["Failed", kpis.whatsapp_failed],
      ["Skipped (no number or opted out)", kpis.whatsapp_skipped],
      ["Active users", kpis.users],
      [`No login for ${STALE_LOGIN_DAYS}+ days`, kpis.stale],
      ["Never logged in", kpis.never_logged_in],
      ["Active users with no phone", kpis.no_phone],
      ["Opted out of WhatsApp", kpis.opted_out],
      ["Recorded changes", kpis.changes],
    ]),
    { name: "WhatsApp", rows: data.whatsapp.map((w) => ({ Status: w.status, Messages: w.count })) },
    {
      name: "WhatsApp problems",
      rows: waProblems.map((m) => ({ Event: m.event, Status: m.status, Person: m.user?.name ?? "", Error: m.error ?? "", When: istDay(m.created_at) })),
    },
    {
      name: "Not logging in",
      rows: stale.map((s) => ({ Name: s.name, Role: s.role, "Last login": s.last_login_at ? istDay(s.last_login_at) : "Never", Days: s.days })),
    },
    { name: "No phone", rows: noPhone.map((u) => ({ Name: u.name, Role: u.role })) },
    { name: "Changes", rows: data.changes.map((c) => ({ Table: c.table, Changes: c.count })) },
  ];
  return { data, sheets };
}

// ---------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------

type Builder = (r: ReportRange, f: Filters) => Promise<Built>;

/** Each tab, who may read it, and how it is built. */
export const REPORT_TABS: Record<string, { roles: Role[]; build: Builder }> = {
  orders: { roles: ["ADMIN", "OPERATION_MANAGER"], build: ordersReport },
  money: { roles: ["ADMIN", "OPERATION_MANAGER", "ACCOUNTS"], build: moneyReport },
  csm: { roles: ["ADMIN", "OPERATION_MANAGER"], build: csmReport },
  production: { roles: ["ADMIN", "OPERATION_MANAGER", "PRODUCTION_MANAGER"], build: (r) => productionReport(r) },
  allocation: { roles: ["ADMIN", "OPERATION_MANAGER"], build: (r) => allocationReport(r) },
  payments: { roles: ["ADMIN", "OPERATION_MANAGER", "COST_CONTROL_MANAGER"], build: paymentsReport },
  masters: { roles: ["ADMIN", "OPERATION_MANAGER"], build: (r) => mastersReport(r) },
  system: { roles: ["ADMIN", "OPERATION_MANAGER"], build: (r) => systemReport(r) },
};

/** Everyone who may read at least one tab. */
const REPORT_ROLES = new Set(Object.values(REPORT_TABS).flatMap((t) => t.roles));

/** The CSM and client pick-lists for the filter bar: people who created orders, every client used. */
export const getReportOptions = async (req: Request, res: Response) => {
  try {
    if (!REPORT_ROLES.has(req.user!.role as Role)) return res.status(403).json({ message: "You don't have access to reports." });
    const [creators, clients] = await Promise.all([
      prisma.order.groupBy({ by: ["created_by"], where: { created_by: { not: null } } }),
      prisma.order.groupBy({ by: ["client_name"], orderBy: { client_name: "asc" } }),
    ]);
    const people = await prisma.user.findMany({
      where: { OR: [{ role: "CSM", deleted_at: null }, { id: { in: creators.map((c) => c.created_by!) } }] },
      select: { id: true, name: true, role: true, is_active: true },
      orderBy: { name: "asc" },
    });
    return res.status(200).json({
      csms: people.map((p) => ({ id: p.id, name: p.name, role: p.role, active: p.is_active })),
      clients: clients.map((c) => c.client_name),
    });
  } catch (err) {
    console.error("Report options error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

async function run(req: Request, res: Response): Promise<(Built & { range: ReportRange }) | null> {
  const tab = Object.prototype.hasOwnProperty.call(REPORT_TABS, String(req.params.tab))
    ? REPORT_TABS[String(req.params.tab)]
    : undefined;
  if (!tab) {
    res.status(404).json({ message: "No such report." });
    return null;
  }
  if (!tab.roles.includes(req.user!.role as Role)) {
    res.status(403).json({ message: "You don't have access to this report." });
    return null;
  }
  let range: ReportRange;
  try {
    range = parseRange(req.query);
  } catch (e) {
    if (e instanceof RangeError400) {
      res.status(400).json({ message: e.message });
      return null;
    }
    throw e;
  }
  const built = await tab.build(range, parseFilters(req.query));
  return { ...built, range };
}

export const getReport = async (req: Request, res: Response) => {
  try {
    const built = await run(req, res);
    if (!built) return;
    return res.status(200).json(serializeDecimals({ range: { from: built.range.from, to: built.range.to }, ...built.data }));
  } catch (err) {
    console.error("Report error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Excel's own limit, and the characters it refuses in a sheet name. */
const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

export const exportReport = async (req: Request, res: Response) => {
  try {
    const built = await run(req, res);
    if (!built) return;
    const wb = xlsx.utils.book_new();
    for (const s of built.sheets) {
      const rows = serializeDecimals(s.rows) as Record<string, unknown>[];
      const sheet = rows.length ? xlsx.utils.json_to_sheet(rows) : xlsx.utils.aoa_to_sheet([["Nothing in this range."]]);
      if (rows.length) {
        sheet["!cols"] = Object.keys(rows[0]!).map((k) => ({
          wch: Math.min(40, Math.max(k.length, ...rows.slice(0, 200).map((row) => String(row[k] ?? "").length)) + 2),
        }));
      }
      xlsx.utils.book_append_sheet(wb, sheet, sheetName(s.name));
    }
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=report_${req.params.tab}_${built.range.from}_to_${built.range.to}.xlsx`,
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (err) {
    console.error("Report export error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
