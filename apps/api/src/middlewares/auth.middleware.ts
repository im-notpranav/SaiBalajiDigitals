import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to perform this action." });
    }
    next();
  };
}

/**
 * Roles that may read everything but change nothing. Applied after `authenticate`,
 * this blocks every state-changing verb so read-only access is enforced at the API,
 * not merely hidden in the UI.
 */
const READ_ONLY_ROLES = ["OPERATION_MANAGER"];

export function denyReadOnlyMutations(req: Request, res: Response, next: NextFunction) {
  if (req.user && READ_ONLY_ROLES.includes(req.user.role) && req.method !== "GET") {
    return res.status(403).json({
      message: "Operation Manager access is view-only. You cannot create, edit, approve or close records.",
    });
  }
  next();
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { is_super_admin: true },
  });
  if (!dbUser?.is_super_admin) {
    return res.status(403).json({ message: "Only the super administrator can perform this action." });
  }
  next();
}
