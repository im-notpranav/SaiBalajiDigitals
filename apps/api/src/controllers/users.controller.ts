import { Request, Response } from "express";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { PASSWORD_HASH_ROUNDS } from "../utils/passwords";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/prisma";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../utils/config";
import { objectStore } from "../utils/object-store";
import { detectFileType } from "../utils/payment-files";

import { createUserSchema, updateMeSchema, updateUserSchema, resetPasswordSchema } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, username: true, role: true, email: true, phone: true, whatsapp_opt_out: true, photo_url: true, is_super_admin: true, created_at: true, is_active: true, last_login_at: true },
    });
    return res.status(200).json({ users });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Minimal roster of active production staff, for the operator's assignment picker.
 * Deliberately narrower than getUsers (no contact details, no admin fields).
 */
export const getProductionStaff = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: "PRODUCTION", is_active: true },
      select: { id: true, name: true, username: true },
      orderBy: { name: "asc" },
    });
    return res.status(200).json({ users });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const checkUsername = async (req: Request, res: Response) => {
  try {
    const { username } = req.query;
    if (!username || typeof username !== "string") {
      return res.status(400).json({ message: "Username is required" });
    }
    const user = await prisma.user.findUnique({ where: { username } });
    return res.status(200).json({ available: !user });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { name, username, password, role, phone, email } = parseResult.data;

    const clash = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });
    if (clash) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    const user = await prisma.user.create({
      data: {
        name,
        username,
        password: hashedPassword,
        role: role as any,
        phone,
        email,
      },
      select: { id: true, name: true, username: true, role: true, phone: true, email: true },
    });

    return res.status(201).json(user);
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({ message: "Username already exists" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Roles the business cannot run without: with no active Admin nobody approves, and with no
 * active Cost Control Manager payouts fall back on the Admin alone. The last active holder
 * of either cannot be removed, switched off or moved to another role (BR-30).
 */
const ESSENTIAL_ROLES: Record<string, string> = {
  ADMIN: "Admin",
  COST_CONTROL_MANAGER: "Cost Control Manager",
};

async function lastHolderBlock(userId: number): Promise<string | null> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, is_active: true } });
  if (!target || !target.is_active || !ESSENTIAL_ROLES[target.role]) return null;
  const others = await prisma.user.count({ where: { role: target.role, is_active: true, id: { not: userId } } });
  if (others > 0) return null;
  const label = ESSENTIAL_ROLES[target.role];
  return `This is the only active ${label}. Add or activate another ${label} first.`;
}

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (req.user!.id === id) {
      return res.status(400).json({ message: "You cannot delete yourself." });
    }

    const targetUser = await prisma.user.findUnique({ where: { id }, select: { is_super_admin: true } });
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.is_super_admin) {
      return res.status(400).json({ message: "You cannot delete the super administrator." });
    }
    const lastHolder = await lastHolderBlock(id);
    if (lastHolder) return res.status(409).json({ message: lastHolder });

    await prisma.user.delete({ where: { id } });
    return res.status(200).json({ message: "User deleted" });
  } catch (err: any) {
    // Records that must outlive the person (payment requests, job slots) block the delete.
    if (err?.code === "P2003" || String(err?.message ?? "").includes("_fkey")) {
      return res.status(400).json({ message: "This user has work or payment history. Deactivate them instead." });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateMe = async (req: Request, res: Response) => {
  try {
    const parseResult = updateMeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { name, whatsapp_opt_out, current_password, new_password } = parseResult.data;
    const userId = req.user!.id;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (whatsapp_opt_out !== undefined) updateData.whatsapp_opt_out = whatsapp_opt_out;

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ message: "Current password is required to set a new password." });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ message: "User not found" });

      const isValid = await bcrypt.compare(current_password, user.password);
      if (!isValid) {
        return res.status(400).json({ message: "Invalid current password" });
      }

      updateData.password = await bcrypt.hash(new_password, PASSWORD_HASH_ROUNDS);
      // Revoke other sessions. The fresh cookie issued below carries a newer timestamp, so the
      // person changing their own password stays signed in here.
      updateData.password_changed_at = new Date();
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, username: true, role: true, email: true, phone: true, whatsapp_opt_out: true, photo_url: true, is_super_admin: true },
    });

    const payload = {
      id: updatedUser.id,
      username: updatedUser.username,
      name: updatedUser.name,
      role: updatedUser.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json(updatedUser);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

const meSelect = { id: true, name: true, username: true, role: true, email: true, phone: true, whatsapp_opt_out: true, photo_url: true, is_super_admin: true } as const;

/**
 * POST /me/photo: the request body is the picture, already shrunk by the browser. Its type
 * is read from its bytes. Each upload gets a new key and URL, so browsers can keep a picture
 * for good and still see a new one straight away.
 */
export const uploadMyPhoto = async (req: Request, res: Response) => {
  try {
    if (!objectStore) return res.status(503).json({ message: "Photo uploads are not set up yet. Ask the admin." });
    const data = Buffer.isBuffer(req.body) ? req.body : null;
    if (!data || data.length === 0) return res.status(400).json({ message: "Choose a picture." });
    const mime = detectFileType(data);
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      return res.status(415).json({ message: "Use a JPG, PNG or WEBP picture." });
    }

    const userId = req.user!.id;
    const version = createHash("sha256").update(data).digest("hex").slice(0, 12);
    const key = `photos/${userId}-${version}`;
    await objectStore.put(key, data, mime);

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { photo_key: true } });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { photo_key: key, photo_url: `/users/${userId}/photo?v=${version}` },
      select: meSelect,
    });
    if (before?.photo_key && before.photo_key !== key) {
      await objectStore.remove(before.photo_key).catch((err) => console.error("Could not remove an old photo", err));
    }
    return res.status(200).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not save the picture. Try again." });
  }
};

/** DELETE /me/photo: back to initials. */
export const removeMyPhoto = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { photo_key: true } });
    const user = await prisma.user.update({ where: { id: userId }, data: { photo_key: null, photo_url: null }, select: meSelect });
    if (before?.photo_key) {
      await objectStore?.remove(before.photo_key).catch((err) => console.error("Could not remove a photo", err));
    }
    return res.status(200).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** GET /:id/photo: a picture, to anyone signed in. The URL changes with the picture. */
export const getUserPhoto = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const user = Number.isInteger(id) ? await prisma.user.findUnique({ where: { id }, select: { photo_key: true } }) : null;
    const data = user?.photo_key && objectStore ? await objectStore.get(user.photo_key) : null;
    if (!data) return res.status(404).json({ message: "No picture" });
    res.setHeader("Content-Type", detectFileType(data) ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).end(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const toggleUserStatus = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { is_active } = req.body;
    
    if (typeof is_active !== "boolean") {
      return res.status(400).json({ message: "is_active must be a boolean" });
    }

    if (req.user!.id === id && !is_active) {
      return res.status(400).json({ message: "You cannot deactivate yourself." });
    }

    const targetUser = await prisma.user.findUnique({ where: { id }, select: { is_super_admin: true } });
    if (targetUser?.is_super_admin && !is_active) {
      return res.status(400).json({ message: "You cannot deactivate the super administrator." });
    }
    if (!is_active) {
      const lastHolder = await lastHolderBlock(id);
      if (lastHolder) return res.status(409).json({ message: lastHolder });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { is_active },
      select: { id: true, name: true, username: true, role: true, is_active: true },
    });

    return res.status(200).json(updatedUser);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Admin-initiated password reset for another account. The target user is not
 * required to supply their current password; the super-admin gate on the route
 * is the control. Self-service password change stays in updateMe.
 */
export const resetUserPassword = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true } });
    if (!target) return res.status(404).json({ message: "User not found" });

    const hashed = await bcrypt.hash(parseResult.data.new_password, PASSWORD_HASH_ROUNDS);
    // Bumping password_changed_at revokes the reset account's existing sessions.
    await prisma.user.update({ where: { id }, data: { password: hashed, password_changed_at: new Date() } });

    return res.status(200).json({ message: `Password reset for ${target.username}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    }
    const { name, username, role, phone, email, whatsapp_opt_out } = parsed.data;

    // Only super admin can change usernames
    const targetUser = await prisma.user.findUnique({ where: { id }, select: { username: true, role: true } });
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (role && role !== targetUser.role) {
      const lastHolder = await lastHolderBlock(id);
      if (lastHolder) return res.status(409).json({ message: lastHolder });
    }
    if (username && username !== targetUser.username && !req.user!.is_super_admin) {
      return res.status(403).json({ message: "Only the super administrator can change usernames." });
    }

    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
      });
      if (existingUser && existingUser.id !== id) {
        return res.status(400).json({ message: "Username already exists" });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        name,
        ...(username ? { username } : {}),
        role: role as any,
        phone,
        email,
        ...(whatsapp_opt_out !== undefined ? { whatsapp_opt_out } : {}),
      },
      select: { id: true, name: true, username: true, role: true, is_active: true, phone: true, email: true, whatsapp_opt_out: true },
    });

    return res.status(200).json(updatedUser);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};
