import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { dayQuery } from "../utils/validators";
import { dayKey, parseDay, todayIST } from "../utils/work-allocation";
import { groupZoneBoard, zoneRange, type ZoneSpan } from "../utils/zone-board";

/**
 * GET /zone-board?date=YYYY-MM-DD&span=day|week — where the team is working on a day or in
 * its week (Monday to Sunday), grouped Hyderabad → area, Non-local → district → area, and
 * Not set. Cancelled jobs are left out. One read; the page drills down without asking again.
 */
export const zoneBoard = async (req: Request, res: Response) => {
  try {
    const date = dayQuery.safeParse(req.query.date).success ? String(req.query.date) : todayIST();
    const span: ZoneSpan = req.query.span === "week" ? "week" : "day";
    const { from, to } = zoneRange(date, span);

    const jobs = await prisma.workJob.findMany({
      where: { status: { not: "CANCELLED" }, start_date: { lte: parseDay(to) }, end_date: { gte: parseDay(from) } },
      select: {
        id: true,
        status: true,
        start_date: true,
        end_date: true,
        locality: true,
        work_details: true,
        area: { select: { id: true, name: true, district: true } },
        order: { select: { order_no: true, client_name: true } },
        csmUser: { select: { name: true } },
        csmCode: { select: { user: { select: { name: true } } } },
        members: { select: { user_id: true, slot_role: true, user: { select: { name: true } } } },
      },
    });

    const groups = groupZoneBoard(
      jobs.map((j) => ({
        id: j.id,
        status: j.status,
        start_date: dayKey(j.start_date),
        end_date: dayKey(j.end_date),
        locality: j.locality,
        work_details: j.work_details,
        area: j.area,
        order: j.order,
        csm: j.csmUser?.name ?? j.csmCode?.user?.name ?? null,
        members: j.members.map((m) => ({ user_id: m.user_id, name: m.user.name, role: m.slot_role })),
      })),
    );
    return res.status(200).json({ date, span, from, to, ...groups });
  } catch (err) {
    console.error("zoneBoard failed:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
