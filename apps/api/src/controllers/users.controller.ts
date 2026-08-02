import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

import { createUserSchema, updateMeSchema } from "../utils/validators";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, username: true, role: true, email: true, phone: true, photo_url: true, is_super_admin: true, created_at: true, is_active: true, last_login_at: true },
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
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    const { name, username, password, role } = parseResult.data;

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        username,
        password: hashedPassword,
        role: role as any,
      },
      select: { id: true, name: true, username: true, role: true },
    });

    return res.status(201).json(user);
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({ message: "Username already exists" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (req.user!.id === id) {
      return res.status(400).json({ message: "You cannot delete yourself." });
    }

    const targetUser = await prisma.user.findUnique({ where: { id }, select: { is_super_admin: true } });
    if (targetUser?.is_super_admin) {
      return res.status(400).json({ message: "You cannot delete the super administrator." });
    }

    await prisma.user.delete({ where: { id } });
    return res.status(200).json({ message: "User deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateMe = async (req: Request, res: Response) => {
  try {
    const parseResult = updateMeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: parseResult.error.errors });
    }
    const { name, email, phone, photo_url, current_password, new_password } = parseResult.data;
    const userId = req.user!.id;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (photo_url !== undefined) updateData.photo_url = photo_url;

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

      updateData.password = await bcrypt.hash(new_password, 12);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, username: true, role: true, email: true, phone: true, photo_url: true, is_super_admin: true },
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

export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { name, username, role } = req.body;

    if (!name || !username || !role) {
      return res.status(400).json({ message: "Name, username, and role are required." });
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser && existingUser.id !== id) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        name,
        username,
        role: role as any,
      },
      select: { id: true, name: true, username: true, role: true, is_active: true },
    });

    return res.status(200).json(updatedUser);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};
