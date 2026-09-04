import { Router } from "express";
import { getDashboard, getAdminDashboard, getCsmDashboard, getProdManagerDashboard, getAccountantDashboard } from "../controllers/dashboard.controller";
import { authenticate, authorize , denyReadOnlyMutations } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(denyReadOnlyMutations);

router.get("/admin", authorize("ADMIN", "OPERATION_MANAGER"), getAdminDashboard);
router.get("/csm", authorize("CSM", "ADMIN", "OPERATION_MANAGER"), getCsmDashboard);
router.get("/prod-manager", authorize("PRODUCTION_MANAGER", "ADMIN"), getProdManagerDashboard);
router.get("/accountant", authorize("ACCOUNTS", "ADMIN"), getAccountantDashboard);
router.get("/", authorize("ADMIN", "OPERATION_MANAGER", "CSM", "ACCOUNTS", "PRODUCTION", "PRODUCTION_MANAGER"), getDashboard);

export default router;
