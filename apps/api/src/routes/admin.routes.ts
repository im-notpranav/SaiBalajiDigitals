import { Router } from "express";
import { getAuditLog, getFinancialYearConfig, getLossReport, getOverdueReport } from "../controllers/admin.controller";
import { authenticate, authorize , denyReadOnlyMutations } from "../middlewares/auth.middleware";

import { getOrderSequence, updateOrderSequence } from "../controllers/settings.controller";

const router = Router();

router.use(authenticate);
// Operation Manager may read every admin report; denyReadOnlyMutations blocks their writes.
router.use(denyReadOnlyMutations);
router.use(authorize("ADMIN", "OPERATION_MANAGER"));

router.get("/audit-log", getAuditLog);
router.get("/financial-year-config", getFinancialYearConfig);
router.get("/order-sequence", getOrderSequence);
router.put("/order-sequence", updateOrderSequence);
router.get("/loss-report", getLossReport);
router.get("/overdue", getOverdueReport);

export default router;
