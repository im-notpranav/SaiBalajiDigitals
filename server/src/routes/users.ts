import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { authenticate, authorize, serializeUser } from "../middleware/auth.js";
import { createUserSchema, updateMeSchema } from "../lib/validators.js";

const router = Router();
const SALT_ROUNDS = 12;

router.get("/", authenticate, authorize("admin"), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { created_at: "desc" } });
  return res.json({
    users: users.map((u) => ({
      ...serializeUser(u),
      created_at: u.created_at.toISOString(),
    })),
  });
});

router.get("/check", authenticate, authorize("admin"), async (req, res) => {
  const username = String(req.query.username ?? "").toLowerCase().trim();
  if (!username) return res.status(400).json({ error: "username required" });
  const existing = await prisma.user.findUnique({ where: { username } });
  return res.json({ available: !existing });
});

router.post("/", authenticate, authorize("admin"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const { name, username, password, role } = parsed.data;
  const normalized = username.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { username: normalized } });
  if (existing) return res.status(400).json({ error: "Username already taken" });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { name, username: normalized, password: hash, role },
  });

  return res.status(201).json({ user: serializeUser(user) });
});

router.delete("/:id", authenticate, authorize("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "User not found" });
  await prisma.user.delete({ where: { id } });
  return res.json({ ok: true });
});

router.put("/me", authenticate, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const { name, current_password, new_password } = parsed.data;
  const data: { name?: string; password?: string } = {};

  if (name) data.name = name;
  if (new_password) {
    if (!current_password) {
      return res.status(400).json({ error: "Current password is required to set a new password" });
    }
    if (!(await bcrypt.compare(current_password, user.password))) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    data.password = await bcrypt.hash(new_password, SALT_ROUNDS);
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return res.json({ user: serializeUser(updated) });
});

export default router;
