import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PASSWORD_HASH_ROUNDS } from "../utils/passwords";
import { prisma } from "../utils/prisma";
import { issueAuthCookie, clearAuthCookie } from "../utils/auth-cookie";

import { loginSchema } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";

/**
 * A throwaway hash compared against when the username is unknown, so a missing account costs the
 * same bcrypt time as a wrong password. Without it, unknown usernames answer noticeably faster and
 * can be enumerated by timing (F9). Computed once at startup.
 */
const DUMMY_HASH = bcrypt.hashSync("no-such-account-placeholder", PASSWORD_HASH_ROUNDS);

export const login = async (req: Request, res: Response) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parseResult.error) });
    }
    const { username, password } = parseResult.data;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Spend the same bcrypt time as a real check so unknown usernames can't be timed apart (F9).
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: "Account is inactive. Please contact the administrator." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        last_login_at: new Date(),
        // The only moment the plain password is at hand to move an older hash to the current cost.
        ...(bcrypt.getRounds(user.password) > PASSWORD_HASH_ROUNDS
          ? { password: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS) }
          : {}),
      },
    });

    issueAuthCookie(res, user);

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        email: user.email,
        phone: user.phone,
        whatsapp_opt_out: user.whatsapp_opt_out,
        photo_url: user.photo_url,
        is_super_admin: user.is_super_admin,
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = (req: Request, res: Response) => {
  clearAuthCookie(res);
  return res.status(200).json({ message: "Logged out successfully" });
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        username: true,
        role: true,
        email: true,
        phone: true,
        whatsapp_opt_out: true,
        photo_url: true,
        is_super_admin: true,
      }
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
};
