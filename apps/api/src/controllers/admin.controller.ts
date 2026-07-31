import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

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

export const getLossReport = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const where: any = { remarks: { not: null } };
    if (from || to) {
      where.remarks_set_at = {};
      if (from) where.remarks_set_at.gte = new Date(String(from));
      if (to) where.remarks_set_at.lte = new Date(String(to));
    }

    const items = await prisma.orderItem.findMany({
      where,
      include: { order: { select: { order_no: true, created_by: true, creator_name: true } } },
    });

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

    return res.status(200).json({
      by_category: byCategory,
      by_employee: Object.values(byEmployee),
      total_loss: items.reduce((s: number, i: any) => s + Number(i.amount), 0),
    });
  } catch (err) {
    console.error("Loss report error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
