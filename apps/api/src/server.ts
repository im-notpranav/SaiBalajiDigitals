import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:5173",
    ],
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);
app.use(express.json());
app.use(cookieParser());

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
