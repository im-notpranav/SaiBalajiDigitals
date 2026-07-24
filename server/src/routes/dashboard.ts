import { Router } from "express";
import { prisma, decimalToNumber } from "../lib/prisma.js";
import { authenticate, authorize } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticate, authorize("admin"), async (_req, res) => {
  const orders = await prisma.order.findMany({ include: { items: true } });

  const total_orders = orders.length;
  let total_revenue = 0;
  let active_orders = 0;
  let pending_orders = 0;

  const revenueByClient = new Map<string, number>();
  const statusCounts = { Active: 0, Pending: 0, Completed: 0 };
  const employeeStats = new Map<number, { name: string; completed: number; revenue: number }>();

  for (const order of orders) {
    const orderTotal = order.items.reduce((s, i) => s + decimalToNumber(i.amount), 0);
    statusCounts[order.status]++;

    if (order.status === "Active") active_orders++;
    if (order.status === "Pending") pending_orders++;
    if (order.status === "Completed") {
      total_revenue += orderTotal;
      revenueByClient.set(order.client_name, (revenueByClient.get(order.client_name) ?? 0) + orderTotal);

      const stat = employeeStats.get(order.created_by) ?? {
        name: order.creator_name,
        completed: 0,
        revenue: 0,
      };
      stat.completed++;
      stat.revenue += orderTotal;
      employeeStats.set(order.created_by, stat);
    }
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyMap = new Map<string, number>();
  for (const order of orders.filter((o) => o.status === "Completed" && o.updated_at >= sixMonthsAgo)) {
    const key = `${order.updated_at.getFullYear()}-${String(order.updated_at.getMonth() + 1).padStart(2, "0")}`;
    const total = order.items.reduce((s, i) => s + decimalToNumber(i.amount), 0);
    monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + total);
  }

  const revenue_trend = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue: Number(revenue.toFixed(2)) }));

  const completedOrders = orders.filter((o) => o.status === "Completed");
  let avgTurnaround = 0;
  if (completedOrders.length) {
    const totalDays = completedOrders.reduce((s, o) => {
      const days = (o.updated_at.getTime() - o.created_at.getTime()) / (1000 * 60 * 60 * 24);
      return s + days;
    }, 0);
    avgTurnaround = Number((totalDays / completedOrders.length).toFixed(1));
  }

  return res.json({
    total_orders,
    total_revenue: Number(total_revenue.toFixed(2)),
    active_orders,
    pending_orders,
    revenue_by_client: [...revenueByClient.entries()]
      .map(([client, revenue]) => ({ client, revenue: Number(revenue.toFixed(2)) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    revenue_trend,
    orders_by_status: statusCounts,
    employee_leaderboard: [...employeeStats.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    avg_turnaround_days: avgTurnaround,
  });
});

export default router;
