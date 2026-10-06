import { Router } from "express";
import { prisma } from "../utils/prisma";

const router = Router();

// Health responses must never be cached by Cloudflare or the monitor, or a dead
// instance could keep reporting "ok".
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Liveness: the process is up and serving. Cheap enough to ping every few minutes
// to keep the Render instance from spinning down. Express answers HEAD on GET routes,
// so monitors that default to HEAD work too.
router.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Readiness: the process can also reach the database. Returns 503 when it can't,
// so an uptime bot pointed here alerts on a broken DB connection, not just a crash.
router.get("/ready", async (req, res) => {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: "ok",
      database: "ok",
      dbLatencyMs: Date.now() - started,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Health check: database unreachable", err);
    res.status(503).json({
      status: "error",
      database: "unreachable",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
