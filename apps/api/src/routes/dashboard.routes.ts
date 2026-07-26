import { Router } from "express";
import { getDashboard, getAdminDashboard } from "../controllers/dashboard.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/admin", authorize("ADMIN"), getAdminDashboard);
router.get("/", authorize("ADMIN", "EMPLOYEE", "ACCOUNTS", "PRODUCTION"), getDashboard);

export default router;
