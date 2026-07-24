import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { signToken, COOKIE_NAME, cookieOptions } from "../lib/jwt.js";
import { authenticate, serializeUser } from "../middleware/auth.js";
import { loginSchema } from "../lib/validators.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase().trim() } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = signToken({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  });

  res.cookie(COOKIE_NAME, token, cookieOptions());
  return res.json({ user: serializeUser(user) });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "strict" });
  return res.json({ ok: true });
});

router.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Session expired. Please log in again." });
  return res.json({ user: serializeUser(user) });
});

export default router;
