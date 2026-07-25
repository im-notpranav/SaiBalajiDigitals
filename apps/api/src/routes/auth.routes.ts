import { Router } from "express";
import { login, logout, getMe } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";
import rateLimit from "express-rate-limit";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});

router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", authenticate, getMe);

export default router;
