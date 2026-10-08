import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { CLOSED_STATUSES, REVENUE_STATUSES, OPEN_STATUSES } from "../utils/order-status";
import { businessDaysBetween, lastProducedAt } from "../utils/order-stage";
import { rollupOrder, storeLabelOf } from "../utils/order-derive";

/**
 * How an order's stores read on a dashboard row: the store itself when there is one, a
 * count when the order covers several. Derived from the stores, not from the order's own
 * legacy store_name column.
 */
/** What an order has been billed, across every invoice raised against it. */
const billedTotal = (order: { invoices?: { bill_amount: any }[] }): number =>
  (order.invoices ?? []).reduce((s, i) => s + (Number(i.bill_amount) || 0), 0);

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const baseWhere: any = {};
    if (user.role === "CSM") {
      baseWhere.created_by = user.id;
    }

    const total_orders = await prisma.order.count({ where: baseWhere });
    const active_orders = await prisma.order.count({ where: { ...baseWhere, status: "Active" } });
    const pending_orders = await prisma.order.count({ where: { ...baseWhere, status: "Pending" } });
    const completed_orders = await prisma.order.count({ where: { ...baseWhere, status: { in: CLOSED_STATUSES } } });

    if (user.role === "PRODUCTION" || user.role === "CSM" || user.role === "PRODUCTION_MANAGER") {
      return res.status(200).json({
        total_orders,
        active_orders,
        pending_orders,
        completed_orders,
      });
    }

    // Revenue is the sum of the invoices raised against closed orders. It cannot be a
    // column aggregate any more: an order carries many invoices.
    const closedInvoices = await prisma.invoice.findMany({
      where: { order: { ...baseWhere, status: { in: CLOSED_STATUSES } } },
      select: { bill_amount: true, order: { select: { client_name: true } } },
    });
    const total_revenue = closedInvoices.reduce((sum, i) => sum + (Number(i.bill_amount) || 0), 0);

    const byClient = new Map<string, number>();
    for (const i of closedInvoices) {
      const key = i.order.client_name;
      byClient.set(key, (byClient.get(key) ?? 0) + (Number(i.bill_amount) || 0));
    }
    const revenue_by_client = [...byClient.entries()]
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const recentOrders = await prisma.order.findMany({
      where: { ...baseWhere, status: { in: REVENUE_STATUSES }, date: { gte: sixMonthsAgo } },
      select: { date: true, id: true, invoices: { select: { bill_amount: true } } },
    });
    
    const trendMap = new Map<string, { revenue: number; orders: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStr = d.toLocaleString('default', { month: 'short' });
      trendMap.set(monthStr, { revenue: 0, orders: 0 });
    }
    
    recentOrders.forEach(o => {
      const monthStr = o.date.toLocaleString('default', { month: 'short' });
      if (trendMap.has(monthStr)) {
        const current = trendMap.get(monthStr)!;
        trendMap.set(monthStr, {
          revenue: current.revenue + billedTotal(o),
          orders: current.orders + 1,
        });
      }
    });
    
    const revenue_trend = Array.from(trendMap.entries()).map(([month, data]) => ({ month, revenue: data.revenue, orders: data.orders }));

    return res.status(200).json({
      total_orders,
      active_orders,
      pending_orders,
      completed_orders,
      total_revenue,
      revenue_by_client,
      revenue_trend,
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
      // Exclude confirmed-loss items — they aren't billable, so they aren't "pending".
      where: { order: { status: "Pending" }, OR: [{ remarks: null }, { remarks_confirmed: false }] },
    });
    const pendingAmount = Number(pendingAmountAgg._sum.amount) || 0;

    // 2. Revenue Trend (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentOrders = await prisma.order.findMany({
      where: { status: { in: REVENUE_STATUSES }, date: { gte: sevenDaysAgo } },
      select: { date: true, invoices: { select: { bill_amount: true } } },
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
        trendMap.set(d, trendMap.get(d)! + billedTotal(o));
      }
    });
    
    const revenueTrend = Array.from(trendMap.entries()).map(([date, revenue]) => ({ date, revenue }));

    // 3. Status Breakdown
    const active_orders = await prisma.order.count({ where: { status: "Active" } });
    const pending_orders = await prisma.order.count({ where: { status: "Pending" } });
    const completed_orders = await prisma.order.count({ where: { status: { in: CLOSED_STATUSES } } });
    const statusBreakdown = [
      { name: "Active", count: active_orders },
      { name: "Pending", count: pending_orders },
      { name: "Completed", count: completed_orders },
    ];

    // 4. Performance Leaderboard. Grouped in memory: the revenue lives on each order's
    // invoices, and Prisma cannot group by a column on one model while summing another's.
    const closedForBoard = await prisma.order.findMany({
      where: { status: { in: CLOSED_STATUSES } },
      select: { creator_name: true, invoices: { select: { bill_amount: true } } },
    });
    const board = new Map<string, { ordersCompleted: number; revenueGenerated: number }>();
    for (const o of closedForBoard) {
      const cur = board.get(o.creator_name) ?? { ordersCompleted: 0, revenueGenerated: 0 };
      cur.ordersCompleted += 1;
      cur.revenueGenerated += billedTotal(o);
      board.set(o.creator_name, cur);
    }
    const performanceLeaderboard = [...board.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.ordersCompleted - a.ordersCompleted)
      .slice(0, 5);

    // 5. Time-to-Close (average hours)
    const completedOrdersList = await prisma.order.findMany({
      where: { status: { in: CLOSED_STATUSES } },
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

export const getCsmDashboard = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { from, to } = req.query as { from?: string; to?: string };

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }

    const baseWhere: any = {};
    if (user.role === "CSM") baseWhere.created_by = user.id;
    if (Object.keys(dateFilter).length) baseWhere.date = dateFilter;

    const orderInclude = {
      items: {
        include: { assignments: true },
      },
      stores: {
        select: { id: true, s_no: true, store_name: true, location: true, installed_at: true, installed_by: true },
        orderBy: { s_no: "asc" as const },
      },
      invoices: true,
    };

    const openOrders = await prisma.order.findMany({
      where: { ...baseWhere, status: { in: OPEN_STATUSES } },
      include: orderInclude,
    });

    const completedOrders = await prisma.order.findMany({
      where: { ...baseWhere, status: { in: CLOSED_STATUSES } },
      include: orderInclude,
    });

    type StageKey = "production" | "installation" | "billing" | "payment";
    const stageMap: Record<StageKey, any[]> = {
      production: [],
      installation: [],
      billing: [],
      payment: [],
    };

    const now = new Date();

    for (const order of openOrders) {
      const items = order.items ?? [];
      const assignedItems = items.filter((i: any) => (i.assignments?.length ?? 0) > 0);
      const hasProduction = assignedItems.length > 0;
      const totalAmount = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
      const totalQty = items.reduce((s: number, i: any) => s + Number(i.qty), 0);

      let stageKey: StageKey;
      let stageSince: Date;

      if (order.status === "BillingCompleted" || order.status === "Pending") {
        stageKey = "payment";
        stageSince = new Date(rollupOrder(order).billing_completed_at ?? order.updated_at);
      } else if (order.status === "Installed") {
        stageKey = "billing";
        stageSince = new Date(rollupOrder(order).installed_at ?? order.updated_at);
      } else {
        // Active
        if (hasProduction && assignedItems.every((i: any) => i.production_completed)) {
          stageKey = "installation";
          const lp = lastProducedAt(order);
          stageSince = lp ?? order.created_at;
        } else {
          stageKey = "production";
          if (hasProduction) {
            const times = assignedItems
              .flatMap((i: any) => i.assignments ?? [])
              .map((a: any) => a.assigned_at)
              .filter(Boolean)
              .map((d: any) => new Date(d).getTime());
            stageSince = times.length ? new Date(Math.max(...times)) : order.created_at;
          } else {
            stageSince = order.created_at;
          }
        }
      }

      const daysInStage = businessDaysBetween(stageSince, now);

      stageMap[stageKey].push({
        id: order.id,
        order_no: order.order_no,
        client_name: order.client_name,
        store_name: storeLabelOf(order),
        store_count: order.stores?.length ?? 1,
        status: order.status,
        total_amount: totalAmount,
        total_qty: totalQty,
        days_in_stage: daysInStage,
        stage_since: stageSince.toISOString(),
      });
    }

    const completedList = completedOrders.map((order) => {
      const items = order.items ?? [];
      const totalAmount = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
      const totalQty = items.reduce((s: number, i: any) => s + Number(i.qty), 0);
      const lp = lastProducedAt(order);

      const roll = rollupOrder(order);
      const endDate = roll.payment_received_at ?? order.updated_at;

      const productionDays = lp
        ? businessDaysBetween(order.created_at, lp)
        : null;
      const installationDays =
        lp && roll.installed_at ? businessDaysBetween(lp, roll.installed_at) : null;
      const billingDays =
        roll.installed_at && roll.billing_completed_at
          ? businessDaysBetween(roll.installed_at, roll.billing_completed_at)
          : null;
      const paymentDays =
        roll.billing_completed_at && endDate
          ? businessDaysBetween(roll.billing_completed_at, new Date(endDate))
          : null;
      const totalDays = businessDaysBetween(order.created_at, new Date(endDate));

      return {
        id: order.id,
        order_no: order.order_no,
        client_name: order.client_name,
        store_name: storeLabelOf(order),
        store_count: order.stores?.length ?? 1,
        total_amount: totalAmount,
        total_qty: totalQty,
        production_days: productionDays,
        installation_days: installationDays,
        billing_days: billingDays,
        payment_days: paymentDays,
        total_days: totalDays,
      };
    });

    const buildStageSummary = (orders: any[]) => ({
      count: orders.length,
      amount: orders.reduce((s: number, o: any) => s + o.total_amount, 0),
      qty: orders.reduce((s: number, o: any) => s + o.total_qty, 0),
    });

    const allOrders = [...openOrders, ...completedOrders];
    const allItems = allOrders.flatMap((o) => o.items ?? []);

    return res.status(200).json({
      summary: {
        total_orders: allOrders.length,
        total_amount: allItems.reduce((s, i: any) => s + Number(i.amount), 0),
        total_qty: allItems.reduce((s, i: any) => s + Number(i.qty), 0),
      },
      stages: {
        production: buildStageSummary(stageMap.production),
        installation: buildStageSummary(stageMap.installation),
        billing: buildStageSummary(stageMap.billing),
        payment: buildStageSummary(stageMap.payment),
        completed: {
          count: completedList.length,
          amount: completedList.reduce((s, o) => s + o.total_amount, 0),
          qty: completedList.reduce((s, o) => s + o.total_qty, 0),
        },
      },
      stage_orders: {
        production: stageMap.production,
        installation: stageMap.installation,
        billing: stageMap.billing,
        payment: stageMap.payment,
        completed: completedList,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getProdManagerDashboard = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // All active orders with items and assignments
    const orders = await prisma.order.findMany({
      where: { status: "Active" },
      include: {
        items: {
          include: {
            assignments: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    const allAssignments: Array<{ assignment: any; item: any; order: any }> = [];
    let totalSftPending = 0;
    let totalSftCompleted = 0;
    let totalItemsPending = 0;
    let totalItemsCompleted = 0;

    for (const order of orders) {
      for (const item of order.items) {
        const sft = Number(item.total_sft);
        if (item.production_completed) {
          totalSftCompleted += sft;
          totalItemsCompleted++;
        } else if (item.assignments.length > 0) {
          totalSftPending += sft;
          totalItemsPending++;
        }
        for (const assignment of item.assignments) {
          allAssignments.push({ assignment, item, order });
        }
      }
    }

    // Per-team stats
    const teamMap = new Map<number, {
      user_id: number;
      name: string;
      assigned_items: number;
      completed_items: number;
      pending_sft: number;
      completed_sft: number;
    }>();

    for (const { assignment, item } of allAssignments) {
      const uid = assignment.user_id;
      if (!teamMap.has(uid)) {
        teamMap.set(uid, {
          user_id: uid,
          name: assignment.user?.name ?? `User #${uid}`,
          assigned_items: 0,
          completed_items: 0,
          pending_sft: 0,
          completed_sft: 0,
        });
      }
      const t = teamMap.get(uid)!;
      t.assigned_items++;
      const sft = Number(item.total_sft);
      if (assignment.completed) {
        t.completed_items++;
        t.completed_sft += sft;
      } else {
        t.pending_sft += sft;
      }
    }

    const teamStats = Array.from(teamMap.values()).map((t) => ({
      ...t,
      pending_sft: Math.round(t.pending_sft * 100) / 100,
      completed_sft: Math.round(t.completed_sft * 100) / 100,
      completion_rate: t.assigned_items > 0
        ? Math.round((t.completed_items / t.assigned_items) * 100)
        : 0,
    })).sort((a, b) => b.pending_sft - a.pending_sft);

    // Pending items (assigned but not production-complete)
    const pendingItems: any[] = [];
    for (const order of orders) {
      for (const item of order.items) {
        if (item.production_completed || item.assignments.length === 0) continue;
        const earliestAssigned = item.assignments
          .map((a: any) => new Date(a.assigned_at).getTime())
          .reduce((min: number, t: number) => Math.min(min, t), Infinity);

        pendingItems.push({
          order_id: order.id,
          order_no: order.order_no,
          client_name: order.client_name,
          item_s_no: item.s_no,
          media: item.media,
          total_sft: Number(item.total_sft),
          assigned_to: item.assignments.map((a: any) => ({
            name: a.user?.name ?? `#${a.user_id}`,
            completed: a.completed,
          })),
          days_since_assigned: businessDaysBetween(new Date(earliestAssigned), now),
        });
      }
    }
    pendingItems.sort((a, b) => b.days_since_assigned - a.days_since_assigned);

    return res.status(200).json({
      summary: {
        total_active_orders: orders.length,
        total_sft_pending: Math.round(totalSftPending * 100) / 100,
        total_sft_completed: Math.round(totalSftCompleted * 100) / 100,
        total_items_pending: totalItemsPending,
        total_items_completed: totalItemsCompleted,
      },
      team_stats: teamStats,
      pending_items: pendingItems,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/* ─── Accountant Dashboard ─────────────────────────────────────── */
export const getAccountantDashboard = async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const now = new Date();

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }

    const baseWhere: any = {};
    if (Object.keys(dateFilter).length) baseWhere.date = dateFilter;

    // Fetch orders at key stages
    const [awaitingBilling, awaitingPayment, recentlyPaid] = await Promise.all([
      // Orders ready to be billed (Installed status)
      prisma.order.findMany({
        where: { ...baseWhere, status: "Installed" },
        include: { items: true, stores: { select: { store_name: true, installed_at: true, installed_by: true } , orderBy: { s_no: "asc" as const } }, invoices: true },
      }),
      // Orders billed, awaiting payment (BillingCompleted or Pending)
      prisma.order.findMany({
        where: { ...baseWhere, status: { in: ["BillingCompleted", "Pending"] } },
        include: { items: true, stores: { select: { store_name: true, installed_at: true, installed_by: true } , orderBy: { s_no: "asc" as const } }, invoices: true },
      }),
      // Recently completed (paid)
      prisma.order.findMany({
        where: { ...baseWhere, status: { in: CLOSED_STATUSES } },
        include: { items: true, stores: { select: { store_name: true, installed_at: true, installed_by: true } , orderBy: { s_no: "asc" as const } }, invoices: true },
      }),
    ]);

    // Also get Active orders that have no production assignments (billable without production)
    const activeNoProd = await prisma.order.findMany({
      where: { ...baseWhere, status: "Active" },
      include: { items: { include: { assignments: true } }, stores: { select: { store_name: true, installed_at: true, installed_by: true }, orderBy: { s_no: "asc" as const } }, invoices: true },
    });
    const activeReady = activeNoProd.filter(
      (o) => !(o.items ?? []).some((i: any) => (i.assignments?.length ?? 0) > 0)
    );

    const calcAmount = (orders: any[]) =>
      orders.reduce(
        (s: number, o: any) =>
          s + (o.items ?? []).reduce((is: number, i: any) => is + Number(i.amount), 0),
        0
      );

    // Overdue: billed >30 days ago without payment
    const OVERDUE_DAYS = 30;
    const overdueOrders = awaitingPayment.filter((o) => {
      const billedAt = rollupOrder(o).billing_completed_at ?? o.updated_at;
      const daysSinceBilled = businessDaysBetween(new Date(billedAt), now);
      return daysSinceBilled > OVERDUE_DAYS;
    });

    // Build stage lists with TAT
    const billingQueue = [...activeReady, ...awaitingBilling].map((o) => {
      const items = o.items ?? [];
      const totalAmount = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
      const installedAt = rollupOrder(o).installed_at;
      const stageSince = installedAt ?? o.created_at;
      return {
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        store_name: storeLabelOf(o),
        store_count: o.stores?.length ?? 1,
        status: o.status,
        total_amount: totalAmount,
        days_waiting: businessDaysBetween(stageSince, now),
        stage_since: stageSince.toISOString(),
      };
    }).sort((a, b) => b.days_waiting - a.days_waiting);

    const paymentQueue = awaitingPayment.map((o) => {
      const items = o.items ?? [];
      const totalAmount = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
      const billedAt = rollupOrder(o).billing_completed_at ?? o.updated_at;
      const daysSinceBilled = businessDaysBetween(new Date(billedAt), now);
      return {
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        store_name: storeLabelOf(o),
        store_count: o.stores?.length ?? 1,
        invoice_no: rollupOrder(o).invoice_no,
        bill_amount: billedTotal(o) || 0,
        total_amount: totalAmount,
        days_since_billed: daysSinceBilled,
        billed_at: new Date(billedAt).toISOString(),
        is_overdue: daysSinceBilled > OVERDUE_DAYS,
        creator_name: o.creator_name,
      };
    }).sort((a, b) => b.days_since_billed - a.days_since_billed);

    const completedList = recentlyPaid.map((o) => {
      const items = o.items ?? [];
      const totalAmount = items.reduce((s: number, i: any) => s + Number(i.amount), 0);
      const billedAt = rollupOrder(o).billing_completed_at;
      const paidAt = rollupOrder(o).payment_received_at ?? o.updated_at;
      const paymentTat = billedAt
        ? businessDaysBetween(new Date(billedAt), new Date(paidAt))
        : null;
      return {
        id: o.id,
        order_no: o.order_no,
        client_name: o.client_name,
        store_name: storeLabelOf(o),
        store_count: o.stores?.length ?? 1,
        invoice_no: rollupOrder(o).invoice_no,
        bill_amount: billedTotal(o) || 0,
        amount_received: Number(rollupOrder(o).amount_received) || 0,
        total_amount: totalAmount,
        payment_tat: paymentTat,
        paid_at: new Date(paidAt).toISOString(),
      };
    }).sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

    // Summary KPIs
    const totalBilled = awaitingPayment.reduce(
      (s, o) => s + (billedTotal(o) || 0),
      0
    );
    const totalCollected = recentlyPaid.reduce(
      (s, o) => s + (Number(rollupOrder(o).amount_received) || 0),
      0
    );
    const overdueAmount = overdueOrders.reduce(
      (s, o) => s + (billedTotal(o) || 0),
      0
    );

    return res.status(200).json({
      summary: {
        billing_queue_count: billingQueue.length,
        billing_queue_amount: calcAmount([...activeReady, ...awaitingBilling]),
        payment_pending_count: awaitingPayment.length,
        payment_pending_amount: totalBilled,
        overdue_count: overdueOrders.length,
        overdue_amount: overdueAmount,
        collected_count: recentlyPaid.length,
        collected_amount: totalCollected,
      },
      billing_queue: billingQueue,
      payment_queue: paymentQueue,
      completed: completedList,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
