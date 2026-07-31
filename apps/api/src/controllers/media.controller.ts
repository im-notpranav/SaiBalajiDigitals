import { Request, Response } from "express";
import { prisma } from "../utils/prisma";

export const searchMedia = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const media = await prisma.media.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : {},
      orderBy: { name: "asc" },
      take: 10,
    });
    return res.status(200).json({ media: media.map((m: any) => m.name) });
  } catch (error) {
    console.error("Error searching media:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
