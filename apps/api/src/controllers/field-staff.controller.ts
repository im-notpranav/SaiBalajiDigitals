import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma";
import { createFieldStaffSchema, updateFieldStaffSchema, resetPasswordSchema } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";
import { FIELD_ROLES, isFieldRole } from "../utils/roles";

/**
 * Field staff (Pasters, Helpers, Drivers) are ordinary users with a field role. This
 * controller is the Operation Manager's way to manage them: every write checks that the
 * target *is* field staff, so the route can never be used to touch an admin, a CSM or
 * accounts. Other roles are still created only by the super admin, in users.controller.
 */

const staffSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  phone: true,
  email: true,
  emp_code: true,
  is_active: true,
  last_login_at: true,
  created_at: true,
} as const;

/** Map a unique-constraint violation to the field the user can fix. */
function uniqueViolationMessage(err: any): string | null {
  if (err?.code !== "P2002") return null;
  const target = String(err.meta?.target ?? "");
  if (target.includes("emp_code")) return "That employee code is already in use.";
  if (target.includes("username")) return "Username already exists";
  return "A record with these details already exists.";
}

/** Load a user by id and confirm they are field staff, or answer the request and return null. */
async function loadFieldStaff(req: Request, res: Response) {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ message: "Invalid id" });
    return null;
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, username: true } });
  if (!target) {
    res.status(404).json({ message: "User not found" });
    return null;
  }
  if (!isFieldRole(target.role)) {
    res.status(403).json({ message: "Only Pasters, Helpers and Drivers can be managed here." });
    return null;
  }
  return target;
}

export const listFieldStaff = async (_req: Request, res: Response) => {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: [...FIELD_ROLES] } },
      select: staffSelect,
      orderBy: [{ is_active: "desc" }, { name: "asc" }],
    });
    return res.status(200).json({ staff });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createFieldStaff = async (req: Request, res: Response) => {
  try {
    const parsed = createFieldStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    }
    const { name, username, password, role, phone, email, emp_code } = parsed.data;

    const clash = await prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } } });
    if (clash) return res.status(400).json({ message: "Username already exists" });

    const user = await prisma.user.create({
      data: {
        name,
        username,
        password: await bcrypt.hash(password, 12),
        role,
        phone,
        email,
        emp_code: emp_code ?? null,
      },
      select: staffSelect,
    });
    return res.status(201).json(user);
  } catch (err: any) {
    const msg = uniqueViolationMessage(err);
    if (msg) return res.status(400).json({ message: msg });
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateFieldStaff = async (req: Request, res: Response) => {
  try {
    const target = await loadFieldStaff(req, res);
    if (!target) return;

    const parsed = updateFieldStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    }

    const user = await prisma.user.update({ where: { id: target.id }, data: parsed.data, select: staffSelect });
    return res.status(200).json(user);
  } catch (err: any) {
    const msg = uniqueViolationMessage(err);
    if (msg) return res.status(400).json({ message: msg });
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Deactivate rather than delete, so jobs and payment history keep their attribution. */
export const setFieldStaffStatus = async (req: Request, res: Response) => {
  try {
    const target = await loadFieldStaff(req, res);
    if (!target) return;

    const { is_active } = req.body ?? {};
    if (typeof is_active !== "boolean") {
      return res.status(400).json({ message: "is_active must be a boolean" });
    }
    const user = await prisma.user.update({ where: { id: target.id }, data: { is_active }, select: staffSelect });
    return res.status(200).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** Field staff forget passwords; the Operation Manager can reset theirs, and only theirs. */
export const resetFieldStaffPassword = async (req: Request, res: Response) => {
  try {
    const target = await loadFieldStaff(req, res);
    if (!target) return;

    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
    }
    await prisma.user.update({
      where: { id: target.id },
      data: { password: await bcrypt.hash(parsed.data.new_password, 12) },
    });
    return res.status(200).json({ message: `Password reset for ${target.username}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
