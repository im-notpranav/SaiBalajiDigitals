import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/prisma";
import { JWT_SECRET, NODE_ENV } from "../utils/config";

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
  is_super_admin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Every request re-reads its user, and that one query is a real share of the small CPU allowance
 * with 150 staff. So a user is remembered briefly: a deactivation or role change takes effect
 * within this time rather than instantly. Tests expect it at once.
 */
const USER_CACHE_MS = NODE_ENV === "test" ? 0 : 15_000;
const recentUsers = new Map<number, {
  user: { id: number; username: string; name: string; role: string; is_active: boolean; is_super_admin: boolean; password_changed_at: Date | null };
  until: number;
}>();

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser & { iat?: number };

    // Re-validate against the database: ensure user is still active and role hasn't changed
    const recent = recentUsers.get(payload.id);
    let dbUser = recent && recent.until > Date.now() ? recent.user : null;
    if (!dbUser) {
      dbUser = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { id: true, username: true, name: true, role: true, is_active: true, is_super_admin: true, password_changed_at: true },
      });
      if (dbUser && USER_CACHE_MS > 0) recentUsers.set(payload.id, { user: dbUser, until: Date.now() + USER_CACHE_MS });
    }

    if (!dbUser || !dbUser.is_active) {
      res.clearCookie("token");
      return res.status(401).json({ message: "Account is inactive or no longer exists. Please contact the administrator." });
    }

    // Tokens minted before the password last changed are stale: a password change or admin
    // reset revokes existing sessions. A 1s allowance covers the token's whole-second `iat`
    // against the millisecond timestamp so a freshly re-issued cookie is never rejected.
    if (dbUser.password_changed_at && payload.iat && payload.iat * 1000 + 1000 < dbUser.password_changed_at.getTime()) {
      res.clearCookie("token");
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }

    // Use live DB role, not the (possibly stale) JWT role
    req.user = { id: dbUser.id, username: dbUser.username, name: dbUser.name, role: dbUser.role, is_super_admin: dbUser.is_super_admin };
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
