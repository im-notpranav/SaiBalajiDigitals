import { Router } from "express";
import { exportReport, getReport, getReportOptions } from "../controllers/reports.controller";
import { authenticate, denyReadOnlyMutations } from "../middlewares/auth.middleware";

/** Read-only. Each tab checks its own roles: see REPORT_TABS in the controller. */
const router = Router();

router.use(authenticate);
router.use(denyReadOnlyMutations);

router.get("/options", getReportOptions);
router.get("/:tab/export", exportReport);
router.get("/:tab", getReport);

export default router;
