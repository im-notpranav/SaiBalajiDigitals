import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/audit-log", authenticate, authorize("admin"), async (req, res) => {
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

  return res.json({
    logs: logs.map((l) => ({
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
});

export default router;
