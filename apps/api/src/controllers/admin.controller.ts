import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { serializeDecimals } from "../utils/serialize";
import { computeTotals, itemAdjustment, orderAdjustmentValue, LOSS_REMARKS, ADJUSTMENT_REMARKS } from "../utils/order-totals";
import { currentStage } from "../utils/order-stage";
import { OPEN_STATUSES } from "../utils/order-status";
import { storeLabelOf, storeLocationOf } from "../utils/order-derive";

export const getAuditLog = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { changed_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count(),
    ]);

    return res.status(200).json({
      logs: logs.map((l: any) => {
        let orderNo = `ID:${l.record_id}`;
        // Try to extract order_no from JSON snapshots for "Order" table
        if (l.table_name === "Order") {
          const data = l.new_data || l.old_data;
          if (data && data.order_no) {
            orderNo = data.order_no;
          }
        }
        
        return {
          id: l.id.toString(),
          table_name: l.table_name,
          record_id: l.record_id,
          order_no: orderNo,
          action: l.action,
          changed_by: l.changed_by,
          user_name: l.user_name,
          old_data: l.old_data,
          new_data: l.new_data,
          changed_at: l.changed_at.toISOString(),
        };
      }),
      pagination: { page, limit, total },
    });
  } catch (err) {
    console.error("Audit log error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getFinancialYearConfig = async (req: Request, res: Response) => {
  try {
    const seq = await prisma.orderSequence.findUnique({ where: { id: 1 } });
    if (!seq) {
      return res.status(404).json({ message: "Sequence not found" });
    }
    return res.status(200).json({
      year_code: seq.year_code,
      last_number: seq.last_number,
    });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Overdue report (Phase 6): open orders stuck at their current stage longer than
 * the threshold (default 5 days). Surfaces where each order is stalled.
 */
export const getOverdueReport = async (req: Request, res: Response) => {
  try {
    const days = Math.max(0, Math.floor(Number(req.query.days ?? 5)) || 0);

    const orders = await prisma.order.findMany({
      where: { status: { in: OPEN_STATUSES } },
      include: {
        items: { include: { assignments: true } },
        stores: { select: { id: true, s_no: true, store_name: true, location: true }, orderBy: { s_no: "asc" } },
        adjustments: { where: { status: "Approved" } },
      },
      orderBy: { created_at: "asc" },
    });

    const overdue: any[] = [];
    const byStage: Record<string, number> = {};

    for (const o of orders) {
      const s = currentStage(o);
      if (!s || s.days_in_stage <= days) continue;
      byStage[s.stage] = (byStage[s.stage] || 0) + 1;
      overdue.push({
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        store_name: storeLabelOf(o),
        location: storeLocationOf(o),
        stores: o.stores,
        store_count: o.stores.length,
        status: o.status,
        creator_name: o.creator_name,
        stage: s.stage,
        stage_since: s.since,
        days_in_stage: s.days_in_stage,
        total_amount: computeTotals(o.items, o.adjustments).total_amount,
      });
    }

    overdue.sort((a, b) => b.days_in_stage - a.days_in_stage);

    return res.status(200).json(
      serializeDecimals({ threshold: days, count: overdue.length, by_stage: byStage, orders: overdue })
    );
  } catch (err) {
    console.error("Overdue report error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getLossReport = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const range = (field: string) => {
      if (!from && !to) return {};
      const r: any = {};
      if (from) r.gte = new Date(String(from));
      // Make `to` inclusive of the entire end day.
      if (to) r.lte = new Date(String(to) + "T23:59:59.999Z");
      return { [field]: r };
    };
    const orderSelect = { select: { order_no: true, client_name: true, created_by: true, creator_name: true } };

    // Only admin-confirmed remarks count; employee proposals are excluded until approved.
    const [items, adjustedItems, orderAdjustments] = await Promise.all([
      prisma.orderItem.findMany({
        where: { remarks: { in: [...LOSS_REMARKS] as any }, remarks_confirmed: true, ...range("remarks_set_at") },
        orderBy: { remarks_set_at: "desc" },
        include: { order: orderSelect },
      }),
      prisma.orderItem.findMany({
        where: { remarks: { in: [...ADJUSTMENT_REMARKS] as any }, remarks_confirmed: true, ...range("remarks_confirmed_at") },
        orderBy: { remarks_confirmed_at: "desc" },
        include: { order: orderSelect },
      }),
      prisma.orderAdjustment.findMany({
        where: { status: "Approved", ...range("decided_at") },
        orderBy: { decided_at: "desc" },
        include: { order: orderSelect, orderStore: { select: { store_name: true } } },
      }),
    ]);

    const byCategory: Record<string, number> = {};
    const byEmployee: Record<string, { name: string; total: number }> = {};

    for (const item of items) {
      const amount = Number(item.amount);
      if (!item.remarks) continue;

      byCategory[item.remarks] = (byCategory[item.remarks] || 0) + amount;
      const empKey = String(item.order.created_by ?? "unassigned");
      if (!byEmployee[empKey]) byEmployee[empKey] = { name: item.order.creator_name, total: 0 };
      byEmployee[empKey].total += amount;
    }

    // Adjustments are reported apart from losses: Less takes money off, Extra adds it, and
    // Revised is the difference between the corrected and the original line.
    const adjustments = [
      ...adjustedItems.map((i: any) => ({
        key: `item-${i.id}`,
        scope: "line" as const,
        type: i.remarks,
        order_id: i.order_id,
        order: i.order,
        description: `${i.media} · ${Number(i.width_inches)}x${Number(i.height_inches)} · ${Number(i.qty)} qty`,
        reason: i.remarks_other_text,
        original_amount: i.remarks === "Revised" ? i.original_amount : i.amount,
        effect: itemAdjustment(i),
        at: i.remarks_confirmed_at,
      })),
      ...orderAdjustments.map((a: any) => ({
        key: `order-${a.id}`,
        scope: "order" as const,
        type: a.type,
        order_id: a.order_id,
        order: a.order,
        description: `Whole order · ${a.orderStore?.store_name ?? ""}`,
        reason: a.reason,
        original_amount: null,
        effect: orderAdjustmentValue(a),
        at: a.decided_at,
      })),
    ].sort((x, y) => new Date(y.at ?? 0).getTime() - new Date(x.at ?? 0).getTime());

    const adjustmentsByType: Record<string, { count: number; amount: number }> = {};
    for (const a of adjustments) {
      const t = (adjustmentsByType[a.type] ??= { count: 0, amount: 0 });
      t.count += 1;
      t.amount += a.effect;
    }

    return res.status(200).json(
      serializeDecimals({
        items,
        by_category: byCategory,
        by_employee: Object.values(byEmployee),
        total_loss: items.reduce((s: number, i: any) => s + Number(i.amount), 0),
        adjustments,
        adjustments_by_type: adjustmentsByType,
        net_adjustment: adjustments.reduce((s, a) => s + a.effect, 0),
      })
    );
  } catch (err) {
    console.error("Loss report error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
