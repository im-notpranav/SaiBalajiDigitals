import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

/** How many names a pick-list shows at a time. Typing narrows it. */
const PICK_LIMIT = 50;

/**
 * GET /api/media?q= — the media pick-list on order lines. Only the admin adds media (Master
 * Library), so archived ones are left out and the list runs A to Z.
 */
export const searchMedia = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 100);
    const media = await prisma.media.findMany({
      where: { is_active: true, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
      orderBy: { name: "asc" },
      select: { name: true },
      take: PICK_LIMIT,
    });
    return res.status(200).json({ media: media.map((m) => m.name) });
  } catch (error) {
    console.error("Error searching media:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
