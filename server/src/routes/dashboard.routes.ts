import { Router } from "express";
import { getDashboard, getAuditLogs } from "../controllers/dashboard.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", authorize("ADMIN"), getDashboard);
router.get("/audit", authorize("ADMIN"), getAuditLogs);

export default router;
