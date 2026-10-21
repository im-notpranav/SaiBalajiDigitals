import { Router } from "express";
import { listLeave, createLeave, updateLeave, cancelLeave, decideLeave } from "../controllers/leave.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

const router = Router();

router.use(authenticate);
// Writable by the Operation Manager (see field-staff.routes.ts); no denyReadOnlyMutations.
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

router.get("/", listLeave);
router.post("/", createLeave);
router.put("/:id", updateLeave);
router.put("/:id/cancel", cancelLeave);
// Field staff's own requests are approved or rejected here.
router.put("/:id/decision", decideLeave);

export default router;
