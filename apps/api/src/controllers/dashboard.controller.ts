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

    if (user.role === "PRODUCTION" || user.role === "EMPLOYEE") {
      return res.status(200).json({
        total_orders,
        active_orders,
        pending_orders,
        completed_orders,
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
      total_revenue,
      revenue_by_client,
    });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getAdminDashboard = async (req: Request, res: Response) => {
  try {
    // 1. Pending Amount (₹)
    const pendingAmountAgg = await prisma.orderItem.aggregate({
      _sum: { amount: true },
      where: { order: { status: "Pending" } },
    });
    const pendingAmount = Number(pendingAmountAgg._sum.amount) || 0;

    // 2. Revenue Trend (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentOrders = await prisma.order.findMany({
      where: { status: "Completed", date: { gte: sevenDaysAgo } },
      select: { date: true, bill_amount: true },
    });
    
    const trendMap = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      trendMap.set(d.toISOString().split('T')[0], 0);
    }
    
    recentOrders.forEach(o => {
      const d = o.date.toISOString().split('T')[0];
      if (trendMap.has(d)) {
        trendMap.set(d, trendMap.get(d)! + (Number(o.bill_amount) || 0));
      }
    });
    
    const revenueTrend = Array.from(trendMap.entries()).map(([date, revenue]) => ({ date, revenue }));

    // 3. Status Breakdown
    const active_orders = await prisma.order.count({ where: { status: "Active" } });
    const pending_orders = await prisma.order.count({ where: { status: "Pending" } });
    const completed_orders = await prisma.order.count({ where: { status: "Completed" } });
    const statusBreakdown = [
      { name: "Active", count: active_orders },
      { name: "Pending", count: pending_orders },
      { name: "Completed", count: completed_orders },
    ];

    // 4. Performance Leaderboard
    const leaderboardRaw = await prisma.order.groupBy({
      by: ["creator_name"],
      _count: { id: true },
      _sum: { bill_amount: true },
      where: { status: "Completed" },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    });
    
    const performanceLeaderboard = leaderboardRaw.map(l => ({
      name: l.creator_name,
      ordersCompleted: l._count.id,
      revenueGenerated: Number(l._sum.bill_amount) || 0,
    }));

    // 5. Time-to-Close (average hours)
    const completedOrdersList = await prisma.order.findMany({
      where: { status: "Completed" },
      select: { created_at: true, updated_at: true },
    });
    
    let totalHours = 0;
    completedOrdersList.forEach(o => {
      const diffMs = o.updated_at.getTime() - o.created_at.getTime();
      totalHours += diffMs / (1000 * 60 * 60);
    });
    const averageTimeToClose = completedOrdersList.length > 0 
      ? Number((totalHours / completedOrdersList.length).toFixed(1)) 
      : 0;

    return res.status(200).json({
      pendingAmount,
      revenueTrend,
      statusBreakdown,
      performanceLeaderboard,
      averageTimeToClose,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
