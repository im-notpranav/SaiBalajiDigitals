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
      logs: logs.map((l: any) => ({
        id: l.id.toString(),
        table_name: l.table_name,
        record_id: l.record_id,
        action: l.action,
        changed_by: l.changed_by,
        old_data: l.old_data,
        new_data: l.new_data,
        changed_at: l.changed_at.toISOString(),
      })),
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
