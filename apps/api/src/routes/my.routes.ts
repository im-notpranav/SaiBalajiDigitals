import { Router } from "express";
import { myJobs } from "../controllers/work-jobs.controller";
import { myLeave } from "../controllers/leave.controller";
import { myOvertime } from "../controllers/overtime.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { FIELD_ROLES } from "../utils/roles";

/** Self-service for field staff: only ever their own records. */
const router = Router();

router.use(authenticate);
router.use(authorize(...FIELD_ROLES));

router.get("/work-jobs", myJobs);
router.get("/leave", myLeave);
router.get("/overtime", myOvertime);

export default router;
