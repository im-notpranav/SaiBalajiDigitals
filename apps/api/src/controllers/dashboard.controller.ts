import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const baseWhere: any = {};
    if (user.role === "EMPLOYEE") {
      baseWhere.created_by = user.id;
    }

    const total_orders = await prisma.order.count({ where: baseWhere });
    const active_orders = await prisma.order.count({ where: { ...baseWhere, status: "Active" } });
    const pending_orders = await prisma.order.count({ where: { ...baseWhere, status: "Pending" } });
    const completed_orders = await prisma.order.count({ where: { ...baseWhere, status: "Completed" } });
    const unsettled_orders = await prisma.order.count({ where: { ...baseWhere, status: "Unsettled" } });

    if (user.role === "PRODUCTION" || user.role === "EMPLOYEE") {
      return res.status(200).json({
        total_orders,
        active_orders,
        pending_orders,
        completed_orders,
        unsettled_orders,
      });
    }

    const total_revenue_agg = await prisma.order.aggregate({
      _sum: { bill_amount: true },
      where: { ...baseWhere, status: "Completed" },
    });
    const total_revenue = Number(total_revenue_agg._sum.bill_amount) || 0;

    const clients = await prisma.order.groupBy({
      by: ["client_name"],
      _sum: { bill_amount: true },
      where: { ...baseWhere, status: "Completed" },
      orderBy: { _sum: { bill_amount: "desc" } },
      take: 5,
    });

    const revenue_by_client = clients.map((c: any) => ({
      name: c.client_name,
      revenue: Number(c._sum.bill_amount) || 0,
    }));

    return res.status(200).json({
      total_orders,
      active_orders,
      pending_orders,
      completed_orders,
      unsettled_orders,
      total_revenue,
      revenue_by_client,
    });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};


