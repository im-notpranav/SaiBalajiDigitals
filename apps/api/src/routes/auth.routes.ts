import { Router } from "express";
import { login, logout, getMe } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";
import rateLimit from "express-rate-limit";
import { clientIpKey } from "../utils/rate-limit";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: clientIpKey,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});

router.post("/login", loginLimiter, login);
router.post("/logout", logout);
// "Who am I?" is asked on every page load, including the login page. With no
// session cookie at all the honest answer is "nobody", not an error — a 401 here
// shows up red in the console of every visitor who simply hasn't signed in yet.
router.get("/me", (req, res, next) => (req.cookies?.token ? next() : res.json({ user: null })), authenticate, getMe);

export default router;
