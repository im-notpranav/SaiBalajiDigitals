import { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { PASSWORD_HASH_ROUNDS } from "../utils/passwords";
import { prisma } from "../utils/prisma";
import { issueAuthCookie } from "../utils/auth-cookie";
import { objectStore } from "../utils/object-store";
import { detectFileType } from "../utils/payment-files";
import { OPEN_PAYMENT_STATUSES } from "../utils/payment-workflow";

import { createUserSchema, updateMeSchema, updateUserSchema, resetPasswordSchema } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Runs `fn` in a transaction that names `actorId` to the audit trigger on User. */
async function withAudit<T>(actorId: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${actorId.toString()}, true)`;
    return fn(tx);
  });
}

export const getUsers = async (req: Request, res: Response) => {
  try {
    // Permanently deleted people stay in the table for history but are never listed.
    const users = await prisma.user.findMany({
      where: { deleted_at: null },
      select: {
        id: true, name: true, username: true, role: true, email: true, phone: true, whatsapp_opt_out: true, photo_url: true,
        is_super_admin: true, created_at: true, is_active: true, last_login_at: true, emp_code: true,
        // Only live codes: a removed code that jobs still carry stays linked but switched off.
        csmCodes: { where: { is_active: true }, select: { id: true, code: true, is_active: true }, orderBy: { code: "asc" } },
      },
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
      where: { role: "PRODUCTION", is_active: true, deleted_at: null },
      select: { id: true, name: true, username: true },
      orderBy: { name: "asc" },
    });
    return res.status(200).json({ users });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Usernames are stored in capitals, so "sbd300" and "SBD300" are the same name. */
export const checkUsername = async (req: Request, res: Response) => {
  try {
    const { username } = req.query;
    if (!username || typeof username !== "string") {
      return res.status(400).json({ message: "Username is required" });
    }
    const user = await prisma.user.findFirst({
      where: { username: { equals: username.trim().toUpperCase(), mode: "insensitive" } },
      select: { id: true },
    });
    return res.status(200).json({ available: !user });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Gives a CSM their code. A code nobody holds is taken over (and switched on); a code held by
 * someone else is refused, so two CSMs never share one. The code is separate from the employee
 * code: CSM code 300 and employee code 300 may belong to different people.
 */
export async function linkCsmCode(tx: Prisma.TransactionClient, userId: number, code: string) {
  const existing = await tx.csmCode.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
    select: { id: true, user_id: true, kind: true, label: true, user: { select: { name: true } } },
  });
  if (existing?.user_id != null && existing.user_id !== userId) {
    throw new HttpError(409, `CSM code ${code} already belongs to ${existing.user?.name ?? "another user"}.`);
  }
  // A team or branch code (e.g. "Vizag branch") is not a person's: taking it over would
  // turn that team's jobs into one CSM's.
  if (existing && (existing.kind === "TEAM" || existing.kind === "BRANCH")) {
    const what = existing.label ? ` (${existing.label})` : "";
    throw new HttpError(409, `CSM code ${code} is a ${existing.kind === "TEAM" ? "team" : "branch"} code${what}, not a person's. Pick another code.`);
  }
  if (existing) {
    await tx.csmCode.update({ where: { id: existing.id }, data: { user_id: userId, kind: "CSM", is_active: true } });
  } else {
    await tx.csmCode.create({ data: { code, kind: "CSM", user_id: userId } });
  }
}

/** Map a unique-constraint violation to the field the admin can fix. */
function uniqueViolationMessage(err: any): string | null {
  if (err?.code !== "P2002") return null;
  const target = String(err.meta?.target ?? "");
  if (target.includes("username")) return "Username already exists";
  // emp_code first: it also contains "code".
  if (target.includes("emp_code")) return "That employee code is already in use.";
  if (target.includes("code")) return "That CSM code is already in use.";
  return "A record with these details already exists.";
}

/**
 * Takes a CSM code off a person (removed, or replaced by another). A code no job has used is
 * freed for anyone. A code that jobs carry stays linked, switched off: jobs count as a CSM's
 * through his codes, so handing it on would move his old jobs to the new holder.
 */
async function releaseCsmCode(tx: Prisma.TransactionClient, userId: number, code: string) {
  const row = await tx.csmCode.findFirst({ where: { user_id: userId, code: { equals: code, mode: "insensitive" } }, select: { id: true } });
  if (!row) return;
  const used = await tx.workJob.count({ where: { OR: [{ csm_code_id: row.id }, { csm2_code_id: row.id }] } });
  await tx.csmCode.update({ where: { id: row.id }, data: used ? { is_active: false } : { user_id: null } });
}

export const createUser = async (req: Request, res: Response) => {
  try {
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { name, username, password, role, phone, email, csm_code } = parseResult.data;

    const clash = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });
    if (clash) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    // The account and its CSM code go in together: a clash on the code leaves no half-made user.
    const user = await withAudit(req.user!.id, async (tx) => {
      const created = await tx.user.create({
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
      if (role === "CSM" && csm_code) await linkCsmCode(tx, created.id, csm_code);
      return created;
    });

    return res.status(201).json(user);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
    const msg = uniqueViolationMessage(err);
    if (msg) return res.status(400).json({ message: msg });
    console.error(err);
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

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "a", "a and b", "a, b and c". */
const listed = (parts: string[]) =>
  parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * Permanent delete, as a tombstone: the row stays so every job, payment, order and log that
 * names this person still points at them, and now reads "Deleted user (Ravi)". What identified
 * or reached them goes: the login (username freed as DELETED_<id>, password replaced with a
 * random one, sessions revoked), contact details, photo, employee code and CSM codes (unlinked
 * so another CSM can take them). Refused while they still have open work, so nothing is left
 * hanging on someone who can no longer act on it.
 *
 * Shared by the Users page (super admin) and the Field Staff page; the routes decide who may.
 */
export async function deleteUserPermanently(actorId: number, id: number): Promise<{ status: number; message: string }> {
  if (actorId === id) return { status: 400, message: "You cannot delete yourself." };

  const target = await prisma.user.findUnique({
    where: { id },
    select: { name: true, is_super_admin: true, deleted_at: true, photo_key: true },
  });
  if (!target || target.deleted_at) return { status: 404, message: "User not found" };
  if (target.is_super_admin) return { status: 400, message: "You cannot delete the super administrator." };
  const lastHolder = await lastHolderBlock(id);
  if (lastHolder) return { status: 409, message: lastHolder };

  const [jobs, payments, leave] = await Promise.all([
    prisma.workJob.count({
      where: {
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        OR: [{ members: { some: { user_id: id } } }, { csm_user_id: id }],
      },
    }),
    prisma.paymentRequest.count({ where: { requested_by: id, status: { in: OPEN_PAYMENT_STATUSES } } }),
    prisma.leaveRecord.count({ where: { user_id: id, status: "PENDING", cancelled_at: null } }),
  ]);
  const open = [
    jobs ? counted(jobs, "open job") : null,
    payments ? counted(payments, "open payment request") : null,
    leave ? counted(leave, "pending leave request") : null,
  ].filter((p): p is string => !!p);
  if (open.length) {
    return { status: 409, message: `${target.name} still has ${listed(open)}. Reassign or close them first.` };
  }

  // Hashed outside the transaction: bcrypt is slow and the row lock need not wait for it.
  const unusablePassword = await bcrypt.hash(randomBytes(32).toString("hex"), PASSWORD_HASH_ROUNDS);
  const now = new Date();
  await withAudit(actorId, async (tx) => {
    // CSM codes stay linked to the deleted person on purpose. Jobs count as a CSM's through
    // his codes, so a code handed to someone new would carry the old CSM's jobs with it.
    // Switching them off keeps them out of pick-lists.
    await tx.csmCode.updateMany({ where: { user_id: id }, data: { is_active: false } });
    await tx.user.update({
      where: { id },
      data: {
        name: `Deleted user (${target.name})`,
        username: `DELETED_${id}`,
        password: unusablePassword,
        email: null,
        phone: null,
        photo_url: null,
        photo_key: null,
        emp_code: null,
        is_active: false,
        deleted_at: now,
        // Tokens issued before this moment are refused, so any open session ends here.
        password_changed_at: now,
        whatsapp_opt_out: true,
      },
    });
  });
  if (target.photo_key) {
    await objectStore?.remove(target.photo_key).catch((err) => console.error("Could not remove a deleted user's photo", err));
  }
  return { status: 200, message: `${target.name} deleted. Their history stays.` };
}

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
    const result = await deleteUserPermanently(req.user!.id, id);
    return res.status(result.status).json({ message: result.message });
  } catch (err: any) {
    console.error(err);
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

    // Re-issue the cookie so a self password change (which bumps password_changed_at) keeps
    // this session alive while revoking the person's other tokens.
    issueAuthCookie(res, updatedUser);

    return res.status(200).json(updatedUser);
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Browsers shrink a picture to a few KB before sending it; this limit only stops abuse. */
export const MAX_PHOTO_BYTES = 512 * 1024;

/**
 * Saves the request body as `userId`'s picture and answers the request. The admin sets
 * pictures (people no longer upload their own); the browser has already shrunk it, and its
 * type is read from its bytes. Each upload gets a new key and URL, so browsers can keep a
 * picture for good and still see a new one straight away.
 *
 * Shared by POST /users/:id/photo and POST /field-staff/:id/photo; the routes decide who may.
 */
export async function sendUserPhotoUpload(req: Request, res: Response, userId: number) {
  try {
    if (!objectStore) return res.status(503).json({ message: "Photo uploads are not set up yet. Ask the admin." });
    const data = Buffer.isBuffer(req.body) ? req.body : null;
    if (!data || data.length === 0) return res.status(400).json({ message: "Choose a picture." });
    const mime = detectFileType(data);
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      return res.status(415).json({ message: "Use a JPG, PNG or WEBP picture." });
    }

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { photo_key: true, deleted_at: true } });
    if (!before || before.deleted_at) return res.status(404).json({ message: "User not found" });

    const version = createHash("sha256").update(data).digest("hex").slice(0, 12);
    const key = `photos/${userId}-${version}`;
    await objectStore.put(key, data, mime);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { photo_key: key, photo_url: `/users/${userId}/photo?v=${version}` },
      select: { id: true, photo_url: true },
    });
    if (before.photo_key && before.photo_key !== key) {
      await objectStore.remove(before.photo_key).catch((err) => console.error("Could not remove an old photo", err));
    }
    return res.status(200).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not save the picture. Try again." });
  }
}

/** Takes `userId`'s picture away (back to initials) and answers the request. */
export async function sendUserPhotoRemoval(res: Response, userId: number) {
  try {
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { photo_key: true, deleted_at: true } });
    if (!before || before.deleted_at) return res.status(404).json({ message: "User not found" });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { photo_key: null, photo_url: null },
      select: { id: true, photo_url: true },
    });
    if (before.photo_key) {
      await objectStore?.remove(before.photo_key).catch((err) => console.error("Could not remove a photo", err));
    }
    return res.status(200).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

const parseUserId = (req: Request) => {
  const id = parseInt(req.params.id as string, 10);
  return Number.isInteger(id) ? id : null;
};

/** POST /:id/photo: the super admin sets anyone's picture. */
export const uploadUserPhoto = async (req: Request, res: Response) => {
  const id = parseUserId(req);
  if (id == null) return res.status(400).json({ message: "Invalid id" });
  return sendUserPhotoUpload(req, res, id);
};

/** DELETE /:id/photo: back to initials. */
export const removeUserPhoto = async (req: Request, res: Response) => {
  const id = parseUserId(req);
  if (id == null) return res.status(400).json({ message: "Invalid id" });
  return sendUserPhotoRemoval(res, id);
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

    const targetUser = await prisma.user.findUnique({ where: { id }, select: { is_super_admin: true, deleted_at: true } });
    // A deleted account stays switched off for good.
    if (!targetUser || targetUser.deleted_at) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser.is_super_admin && !is_active) {
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

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, deleted_at: true } });
    if (!target || target.deleted_at) return res.status(404).json({ message: "User not found" });

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
    const { name, username, role, phone, email, whatsapp_opt_out, csm_code, replace_csm_code, emp_code } = parsed.data;

    // Only super admin can change usernames
    const targetUser = await prisma.user.findUnique({ where: { id }, select: { username: true, role: true, deleted_at: true } });
    if (!targetUser || targetUser.deleted_at) {
      return res.status(404).json({ message: "User not found" });
    }
    // The super admin may edit his own account, but not his own role: moving himself off
    // Admin would lock him out of the screens he needs to undo it.
    if (id === req.user!.id && role && role !== targetUser.role) {
      return res.status(400).json({ message: "You can't change your own role." });
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

    const updatedUser = await withAudit(req.user!.id, async (tx) => {
      const saved = await tx.user.update({
        where: { id },
        data: {
          name,
          ...(username ? { username } : {}),
          role: role as any,
          phone,
          email,
          ...(whatsapp_opt_out !== undefined ? { whatsapp_opt_out } : {}),
          // Sent as null to clear it; left out to keep it.
          ...(emp_code !== undefined ? { emp_code: emp_code || null } : {}),
        },
        select: { id: true, name: true, username: true, role: true, is_active: true, phone: true, email: true, whatsapp_opt_out: true, emp_code: true },
      });
      // Optional on edit: CSMs made before codes were asked for still save without one.
      if (role === "CSM" && csm_code) {
        await linkCsmCode(tx, id, csm_code);
        // A change, not an addition: the old code is let go (see releaseCsmCode).
        if (replace_csm_code && replace_csm_code !== csm_code) await releaseCsmCode(tx, id, replace_csm_code);
      } else if (replace_csm_code && !csm_code) {
        // The box was emptied: the CSM code is removed.
        await releaseCsmCode(tx, id, replace_csm_code);
      }
      return saved;
    });

    return res.status(200).json(updatedUser);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
    if (err.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    const msg = uniqueViolationMessage(err);
    if (msg) return res.status(400).json({ message: msg });
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/users/csm-directory — every person who can own an order (CSMs and admins), with
 * their CSM code, so any screen can show "CSM name" beside an order number, or the short code
 * where space is tight. Deleted people stay listed so old orders keep a name.
 */
export const getCsmDirectory = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: ["CSM", "ADMIN"] } },
      select: {
        id: true,
        name: true,
        username: true,
        csmCodes: { select: { code: true, is_active: true }, orderBy: { id: "asc" } },
      },
      orderBy: { name: "asc" },
    });
    const directory = users.map((u) => {
      const code = u.csmCodes.find((c) => c.is_active)?.code ?? u.csmCodes[0]?.code ?? null;
      return { id: u.id, name: u.name, username: u.username, code };
    });
    res.set("Cache-Control", "private, max-age=300");
    return res.json({ directory });
  } catch (error) {
    console.error("getCsmDirectory error:", error);
    return res.status(500).json({ message: "Could not load the CSM list." });
  }
};
