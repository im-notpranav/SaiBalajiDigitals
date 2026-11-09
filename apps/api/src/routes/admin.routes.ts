import { Router } from "express";
import { getAuditLog, getFinancialYearConfig, getLossReport, getOverdueReport } from "../controllers/admin.controller";
import { authenticate, authorize , denyReadOnlyMutations } from "../middlewares/auth.middleware";

import { getOrderSequence, getPaymentSettings, updateOrderSequence, updatePaymentSettings } from "../controllers/settings.controller";

const router = Router();

router.use(authenticate);
// Operation Manager may read every admin report; denyReadOnlyMutations blocks their writes.
router.use(denyReadOnlyMutations);
// The Accountant portal has a Financial Year page too; it only reads the year code.
router.get(
  "/financial-year-config",
  authorize("ADMIN", "OPERATION_MANAGER", "ACCOUNTS"),
  getFinancialYearConfig,
);
router.use(authorize("ADMIN", "OPERATION_MANAGER"));

router.get("/audit-log", getAuditLog);
router.get("/order-sequence", getOrderSequence);
router.put("/order-sequence", updateOrderSequence);
router.get("/loss-report", getLossReport);
router.get("/overdue", getOverdueReport);
router.get("/payment-settings", getPaymentSettings);
router.put("/payment-settings", authorize("ADMIN"), updatePaymentSettings);

export default router;
