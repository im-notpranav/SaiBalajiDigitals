import { Router } from "express";
import { getAuditLog, getFinancialYearConfig } from "../controllers/admin.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(authorize("ADMIN"));

router.get("/audit-log", getAuditLog);
router.get("/financial-year-config", getFinancialYearConfig);

export default router;
