import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

/** How many names a pick-list shows at a time. Typing narrows it. */
const PICK_LIMIT = 50;

/**
 * GET /api/clients?q= — the client pick-list on orders. Only the admin adds clients (Master
 * Library), so archived ones are left out and the list runs A to Z.
 */
export const searchClients = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 100);
    const clients = await prisma.client.findMany({
      where: { is_active: true, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
      orderBy: { name: "asc" },
      select: { name: true },
      take: PICK_LIMIT,
    });
    return res.status(200).json({ clients: clients.map((c) => c.name) });
  } catch (error) {
    console.error("Error searching clients:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
