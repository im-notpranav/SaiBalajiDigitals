import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const total_orders = await prisma.order.count();
    const active_orders = await prisma.order.count({ where: { status: "Active" } });
    const pending_orders = await prisma.order.count({ where: { status: "Pending" } });
    const completed_orders = await prisma.order.count({ where: { status: "Completed" } });

    const total_revenue_agg = await prisma.order.aggregate({
      _sum: { bill_amount: true },
      where: { status: "Completed" },
    });
    const total_revenue = Number(total_revenue_agg._sum.bill_amount) || 0;

    const clients = await prisma.order.groupBy({
      by: ["client_name"],
      _sum: { bill_amount: true },
      where: { status: "Completed" },
      orderBy: { _sum: { bill_amount: "desc" } },
      take: 5,
    });

    const revenue_by_client = clients.map((c) => ({
      name: c.client_name,
      revenue: Number(c._sum.bill_amount) || 0,
    }));

    return res.status(200).json({
      total_orders,
      active_orders,
      pending_orders,
      completed_orders,
      total_revenue,
      revenue_by_client,
    });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    
    // We cast id (BigInt) to string for JSON serialization
    const logs = await prisma.auditLog.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { changed_at: "desc" },
    });
    
    const count = await prisma.auditLog.count();
    
    const formatted = logs.map(l => ({
      ...l,
      id: l.id.toString(),
    }));

    return res.status(200).json({ data: formatted, total: count, page });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};
