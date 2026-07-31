import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

export const searchClients = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const clients = await prisma.client.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      orderBy: { name: "asc" },
      take: 10,
    });
    return res.status(200).json({ clients: clients.map((c: any) => c.name) });
  } catch (error) {
    console.error("Error searching clients:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
