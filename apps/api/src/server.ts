// Config import must come first — it loads dotenv and validates required env vars.
import { PORT, CLIENT_URL } from "./utils/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { clientIpKey } from "./utils/rate-limit";

const app = express();

// Behind Cloudflare -> Render. Required for correct req.ip and rate limiting.
app.set("trust proxy", 1);

app.use(helmet());

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

// Global rate limit: 200 requests per minute per IP (generous for 50-60 employees)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientIpKey,
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
import { initEmailService } from "./services/email.service";

app.use("/api/auth", authRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationsRoutes);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await initEmailService();
});
