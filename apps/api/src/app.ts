// Config import must come first — it loads dotenv and validates required env vars.
import { CLIENT_URL, NODE_ENV } from "./utils/config";

import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { userOrIpKey } from "./utils/rate-limit";

/**
 * The Express app, without listening or background workers, so tests can drive it
 * directly. server.ts starts it.
 */
const app = express();

// Behind Cloudflare -> Render. Required for correct req.ip and rate limiting.
app.set("trust proxy", 1);

app.use(helmet());
// Long lists shrink a great deal for a phone on mobile data. The low level costs little of the
// small CPU share the free hosting gives; small replies are left as they are.
app.use(compression({ level: 4, threshold: 2048 }));

// Health checks sit ahead of CORS and the rate limiter so uptime monitors
// (which send no Origin and ping on a schedule) are never blocked or throttled.
import healthRoutes from "./routes/health.routes";
app.use("/health", healthRoutes);

// Support comma-separated origins so preview deployments don't need an API redeploy.
const allowedOrigins = CLIENT_URL.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// AskEva's delivery reports arrive in bursts from a few addresses, so the webhook sits ahead
// of the per-IP limiter. It needs no login; a shared secret guards it instead.
import whatsappRoutes, { webhookRouter } from "./routes/whatsapp.routes";
app.use("/api/webhooks", webhookRouter);

// Global rate limit: 300 requests per minute per signed-in person, and per address for everyone
// signed out, which covers the login page of a full office at nine.
// The API test suite sends far more than that from one address, so it is off under test.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    skip: () => NODE_ENV === "test",
    message: { message: "Too many requests. Please slow down." },
  })
);

import authRoutes from "./routes/auth.routes";
import ordersRoutes from "./routes/orders.routes";
import usersRoutes from "./routes/users.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import clientsRoutes from "./routes/clients.routes";
import mediaRoutes from "./routes/media.routes";
import adminRoutes from "./routes/admin.routes";
import notificationsRoutes from "./routes/notifications.routes";
import fieldStaffRoutes from "./routes/field-staff.routes";
import mastersRoutes from "./routes/masters.routes";
import workJobsRoutes from "./routes/work-jobs.routes";
import csmJobsRoutes from "./routes/csm-jobs.routes";
import myRoutes from "./routes/my.routes";
import leaveRoutes from "./routes/leave.routes";
import overtimeRoutes from "./routes/overtime.routes";
import paymentRequestsRoutes from "./routes/payment-requests.routes";

app.use("/api/auth", authRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/field-staff", fieldStaffRoutes);
app.use("/api/masters", mastersRoutes);
app.use("/api/work-jobs", workJobsRoutes);
app.use("/api/csm-jobs", csmJobsRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/overtime", overtimeRoutes);
app.use("/api/payment-requests", paymentRequestsRoutes);
app.use("/api/my", myRoutes);
app.use("/api/whatsapp", whatsappRoutes);

export default app;
