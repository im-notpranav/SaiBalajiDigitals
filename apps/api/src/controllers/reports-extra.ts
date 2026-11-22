import { prisma } from "../utils/prisma";
import { computeTotals } from "../utils/order-totals";
import { getSetting } from "../utils/app-settings";
import { istDay, istMonth, mean1, monthLabel, monthsOf, round1, round2, type ReportRange } from "../utils/report-range";

/**
 * Report tabs added with the Nov 17 change list: Printing (line by line, per operator),
 * Delay (days each order spent in each stage against the limits in Settings) and Turnover
 * (orders raised, billed and received, by month and by CSM).
 */

interface Sheet {
  name: string;
  rows: Record<string, unknown>[];
}
export interface Built {
  data: Record<string, unknown>;
  sheets: Sheet[];
}
export interface Viewer {
  id: number;
  role: string;
}
export interface ExtraFilters {
  csm?: number;
  client?: string;
  operator?: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => round1((b.getTime() - a.getTime()) / DAY_MS);
const sizeOf = (w: unknown, h: unknown) => `${Number(w)} x ${Number(h)} in`;
const ist = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");

// ---------------------------------------------------------------------------------------
// Printing: every line started or finished in the range
// ---------------------------------------------------------------------------------------

export async function printingReport(r: ReportRange, f: ExtraFilters, viewer: Viewer): Promise<Built> {
  // An operator sees only their own work; the PM and admins may pick one operator or all.
  const operator = viewer.role === "PRODUCTION" ? viewer.id : f.operator;
  const inWindow = { gte: r.start, lt: r.end };
  const lines = await prisma.orderItem.findMany({
    where: {
      AND: [
        { OR: [{ started_at: inWindow }, { production_completed_at: inWindow }, { assignments: { some: { completed_at: inWindow } } }] },
        ...(operator ? [{ OR: [{ started_by: operator }, { assignments: { some: { user_id: operator } } }] }] : []),
        ...(f.client ? [{ order: { client_name: f.client } }] : []),
        ...(f.csm ? [{ order: { created_by: f.csm } }] : []),
      ],
    },
    select: {
      id: true,
      media: true,
      width_inches: true,
      height_inches: true,
      qty: true,
      total_sft: true,
      started_at: true,
      started_by: true,
      production_completed: true,
      production_completed_at: true,
      machine: { select: { name: true } },
      orderStore: { select: { store_name: true, location: true } },
      order: { select: { id: true, order_no: true, client_name: true, creator_name: true } },
      assignments: { select: { user_id: true, completed_at: true, user: { select: { name: true } } } },
    },
    orderBy: [{ production_completed_at: "asc" }, { started_at: "asc" }],
    take: 20_000,
  });
  const starterIds = [...new Set(lines.map((l) => l.started_by).filter((x): x is number => !!x))];
  const starters = new Map((await prisma.user.findMany({ where: { id: { in: starterIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const rows = lines.map((l) => {
    const names = new Set<string>();
    if (l.started_by && starters.get(l.started_by)) names.add(starters.get(l.started_by)!);
    for (const a of l.assignments) names.add(a.user.name);
    const finished = l.assignments.map((a) => a.completed_at).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime());
    const done = l.production_completed_at ?? finished[0] ?? null;
    const day = done ?? l.started_at;
    return {
      line_id: l.id,
      order_id: l.order.id,
      date: day ? istDay(day) : null,
      order_no: l.order.order_no,
      csm: l.order.creator_name,
      client: l.order.client_name,
      store: l.orderStore ? `${l.orderStore.store_name} (${l.orderStore.location})` : "",
      line_item: l.media,
      machine: l.machine?.name ?? null,
      size: sizeOf(l.width_inches, l.height_inches),
      qty: Number(l.qty),
      sft: round2(Number(l.total_sft)),
      operators: [...names].join(", "),
      started: l.started_at,
      completed: done,
      done: l.production_completed,
    };
  });

  const byOperator = new Map<string, { operator: string; lines: number; sft: number; completed: number }>();
  const byMachine = new Map<string, { machine: string; lines: number; sft: number }>();
  for (const row of rows) {
    for (const name of row.operators ? row.operators.split(", ") : ["Not recorded"]) {
      const o = byOperator.get(name) ?? { operator: name, lines: 0, sft: 0, completed: 0 };
      o.lines++;
      o.sft = round2(o.sft + row.sft);
      if (row.done) o.completed++;
      byOperator.set(name, o);
    }
    const key = row.machine ?? "No machine";
    const m = byMachine.get(key) ?? { machine: key, lines: 0, sft: 0 };
    m.lines++;
    m.sft = round2(m.sft + row.sft);
    byMachine.set(key, m);
  }

  const operators =
    viewer.role === "PRODUCTION"
      ? []
      : await prisma.user.findMany({ where: { role: "PRODUCTION", deleted_at: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  const totals = { lines: rows.length, sft: round2(rows.reduce((s, x) => s + x.sft, 0)), completed: rows.filter((x) => x.done).length };
  const opRows = [...byOperator.values()].sort((a, b) => b.sft - a.sft);
  const machineRows = [...byMachine.values()].sort((a, b) => b.sft - a.sft);
  return {
    data: { totals, rows: rows.slice(0, 2000), row_count: rows.length, by_operator: opRows, by_machine: machineRows, operators, operator: operator ?? null },
    sheets: [
      {
        name: "Printing",
        rows: rows.map((x) => ({
          Date: x.date,
          "Order no": x.order_no,
          CSM: x.csm,
          Client: x.client,
          Store: x.store,
          "Line item": x.line_item,
          Machine: x.machine ?? "",
          Size: x.size,
          Qty: x.qty,
          SFT: x.sft,
          Operator: x.operators,
          Started: ist(x.started),
          Completed: ist(x.completed),
        })),
      },
      { name: "By operator", rows: opRows.map((o) => ({ Operator: o.operator, Lines: o.lines, Completed: o.completed, SFT: o.sft })) },
      { name: "By machine", rows: machineRows.map((m) => ({ Machine: m.machine, Lines: m.lines, SFT: m.sft })) },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// Delay: days per stage for orders raised in the range
// ---------------------------------------------------------------------------------------

export const STAGES = ["production", "installation", "invoice", "payment"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, string> = { production: "Production", installation: "Installation", invoice: "Invoice", payment: "Payment" };

const latest = (ds: (Date | null | undefined)[]) => {
  const xs = ds.filter((d): d is Date => !!d);
  return xs.length ? new Date(Math.max(...xs.map((d) => d.getTime()))) : null;
};

export async function delayReport(r: ReportRange, f: ExtraFilters): Promise<Built> {
  const limits = await getSetting("delay_limits");
  const orders = await prisma.order.findMany({
    where: {
      created_at: { gte: r.start, lt: r.end },
      merged_into_id: null,
      ...(f.csm ? { created_by: f.csm } : {}),
      ...(f.client ? { client_name: f.client } : {}),
    },
    select: {
      id: true,
      order_no: true,
      client_name: true,
      creator_name: true,
      created_at: true,
      status: true,
      items: { select: { production_completed: true, production_completed_at: true } },
      stores: { select: { installed_at: true } },
      invoices: { select: { billing_date: true, payment_received_at: true } },
    },
    orderBy: { created_at: "asc" },
    take: 10_000,
  });
  const now = new Date();
  const rows = orders.map((o) => {
    const prodDone = o.items.length > 0 && o.items.every((i) => i.production_completed) ? latest(o.items.map((i) => i.production_completed_at)) : null;
    const installDone = o.stores.length > 0 && o.stores.every((s) => s.installed_at) ? latest(o.stores.map((s) => s.installed_at)) : null;
    const billed = o.invoices.length > 0 && o.invoices.every((i) => i.billing_date) ? latest(o.invoices.map((i) => i.billing_date)) : null;
    const paid = o.invoices.length > 0 && o.invoices.every((i) => i.payment_received_at) ? latest(o.invoices.map((i) => i.payment_received_at)) : null;
    // Each stage runs from the end of the one before to its own end, or to now while open.
    const span = (from: Date | null, to: Date | null) => (from ? { days: Math.max(0, daysBetween(from, to ?? now)), open: !to } : null);
    const stages: Record<Stage, { days: number; open: boolean } | null> = {
      production: span(o.created_at, prodDone),
      installation: span(prodDone, installDone),
      invoice: span(installDone, billed),
      payment: span(billed, paid),
    };
    const late = STAGES.filter((s) => stages[s] && stages[s]!.days > limits[s]);
    const current = STAGES.find((s) => stages[s]?.open) ?? null;
    return {
      order_id: o.id,
      order_no: o.order_no,
      client: o.client_name,
      csm: o.creator_name,
      date: istDay(o.created_at),
      status: o.status,
      current,
      stages,
      late,
      total_days: daysBetween(o.created_at, paid ?? now),
    };
  });
  const summary = STAGES.map((s) => {
    const xs = rows.map((row) => row.stages[s]).filter((x): x is { days: number; open: boolean } => !!x);
    return {
      stage: s,
      label: STAGE_LABEL[s],
      limit: limits[s],
      orders: xs.length,
      average_days: mean1(xs.map((x) => x.days)),
      over_limit: rows.filter((row) => row.late.includes(s)).length,
      open_now: xs.filter((x) => x.open).length,
    };
  });
  const sorted = rows.slice().sort((a, b) => b.late.length - a.late.length || b.total_days - a.total_days);
  return {
    data: { limits, summary, rows: sorted.slice(0, 1500), row_count: rows.length, late_orders: rows.filter((x) => x.late.length > 0).length },
    sheets: [
      {
        name: "Stages",
        rows: summary.map((s) => ({ Stage: s.label, "Limit (days)": s.limit, Orders: s.orders, "Average days": s.average_days ?? "", "Over limit": s.over_limit, "Open now": s.open_now })),
      },
      {
        name: "Orders",
        rows: sorted.map((x) => ({
          "Order no": x.order_no,
          Date: x.date,
          Client: x.client,
          CSM: x.csm,
          Status: x.status,
          ...Object.fromEntries(STAGES.map((s) => [`${STAGE_LABEL[s]} days`, x.stages[s] ? `${x.stages[s]!.days}${x.stages[s]!.open ? " (open)" : ""}` : ""])),
          "Late in": x.late.map((s) => STAGE_LABEL[s]).join(", "),
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// Turnover: raised, billed and received, by month and by CSM
// ---------------------------------------------------------------------------------------

export async function turnoverReport(r: ReportRange, f: ExtraFilters): Promise<Built> {
  const scope = { ...(f.csm ? { created_by: f.csm } : {}), ...(f.client ? { client_name: f.client } : {}) };
  const [raised, billed, received] = await Promise.all([
    prisma.order.findMany({
      where: { ...scope, created_at: { gte: r.start, lt: r.end }, merged_into_id: null },
      select: { created_at: true, created_by: true, creator_name: true, items: true, adjustments: { where: { status: "Approved" } } },
    }),
    prisma.invoice.findMany({
      where: { billing_date: { gte: r.start, lt: r.end }, order: scope },
      select: { billing_date: true, bill_amount: true, order: { select: { created_by: true, creator_name: true } } },
    }),
    prisma.invoice.findMany({
      where: { payment_received_at: { gte: r.start, lt: r.end }, order: scope },
      select: { payment_received_at: true, amount_received: true, bill_amount: true, order: { select: { created_by: true, creator_name: true } } },
    }),
  ]);
  type Figures = { orders: number; raised: number; billed: number; received: number };
  const months = new Map(monthsOf(r).map((m) => [m, { month: m, label: monthLabel(m), orders: 0, raised: 0, billed: 0, received: 0 }]));
  const csms = new Map<string, Figures & { csm: string }>();
  const csmRow = (id: number | null, name: string) => {
    const key = String(id ?? name);
    const row = csms.get(key) ?? { csm: name, orders: 0, raised: 0, billed: 0, received: 0 };
    csms.set(key, row);
    return row;
  };
  for (const o of raised) {
    const value = computeTotals(o.items, o.adjustments).total_amount;
    const m = months.get(istMonth(o.created_at));
    if (m) {
      m.orders++;
      m.raised = round2(m.raised + value);
    }
    const c = csmRow(o.created_by, o.creator_name);
    c.orders++;
    c.raised = round2(c.raised + value);
  }
  for (const i of billed) {
    const v = Number(i.bill_amount);
    const m = months.get(istMonth(i.billing_date!));
    if (m) m.billed = round2(m.billed + v);
    const c = csmRow(i.order.created_by, i.order.creator_name);
    c.billed = round2(c.billed + v);
  }
  for (const i of received) {
    const v = Number(i.amount_received ?? i.bill_amount);
    const m = months.get(istMonth(i.payment_received_at!));
    if (m) m.received = round2(m.received + v);
    const c = csmRow(i.order.created_by, i.order.creator_name);
    c.received = round2(c.received + v);
  }
  const byMonth = [...months.values()];
  const byCsm = [...csms.values()].sort((a, b) => b.raised - a.raised);
  const totals = {
    orders: raised.length,
    raised: round2(byMonth.reduce((s, m) => s + m.raised, 0)),
    billed: round2(byMonth.reduce((s, m) => s + m.billed, 0)),
    received: round2(byMonth.reduce((s, m) => s + m.received, 0)),
  };
  const sheetRow = (x: Figures) => ({ Orders: x.orders, "Order value": x.raised, Billed: x.billed, Received: x.received });
  return {
    data: { totals, by_month: byMonth, by_csm: byCsm },
    sheets: [
      { name: "By month", rows: byMonth.map((m) => ({ Month: m.label, ...sheetRow(m) })) },
      { name: "By CSM", rows: byCsm.map((c) => ({ CSM: c.csm, ...sheetRow(c) })) },
    ],
  };
}
