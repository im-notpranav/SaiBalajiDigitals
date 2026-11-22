import { Router } from "express";
import { getAuditLog, getLossReport, getOverdueReport } from "../controllers/admin.controller";
import { authenticate, authorize , denyReadOnlyMutations } from "../middlewares/auth.middleware";

import { getDelayLimits, getOrderSequence, getPaymentSettings, updateDelayLimits, updateOrderSequence, updatePaymentSettings } from "../controllers/settings.controller";

const router = Router();

router.use(authenticate);
// Operation Manager may read every admin report; denyReadOnlyMutations blocks their writes.
router.use(denyReadOnlyMutations);
router.use(authorize("ADMIN", "OPERATION_MANAGER"));

router.get("/audit-log", getAuditLog);
router.get("/order-sequence", getOrderSequence);
router.put("/order-sequence", updateOrderSequence);
router.get("/loss-report", getLossReport);
router.get("/overdue", getOverdueReport);
router.get("/payment-settings", getPaymentSettings);
router.put("/payment-settings", authorize("ADMIN"), updatePaymentSettings);
router.get("/delay-limits", getDelayLimits);
router.put("/delay-limits", authorize("ADMIN"), updateDelayLimits);

export default router;
