import { Router } from "express";
import { getAuditLog, getFinancialYearConfig, getLossReport, getOverdueReport } from "../controllers/admin.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

import { getOrderSequence, updateOrderSequence } from "../controllers/settings.controller";

const router = Router();

router.use(authenticate);
router.use(authorize("ADMIN"));

router.get("/audit-log", getAuditLog);
router.get("/financial-year-config", getFinancialYearConfig);
router.get("/order-sequence", getOrderSequence);
router.put("/order-sequence", updateOrderSequence);
router.get("/loss-report", getLossReport);
router.get("/overdue", getOverdueReport);

export default router;
