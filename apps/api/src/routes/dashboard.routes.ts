import { Router } from "express";
import { getDashboard } from "../controllers/dashboard.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", authorize("ADMIN", "EMPLOYEE", "ACCOUNTS", "PRODUCTION"), getDashboard);

export default router;
