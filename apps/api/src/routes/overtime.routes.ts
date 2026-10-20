import { Router } from "express";
import { listOvertime, createOvertime, updateOvertime, deleteOvertime, decideOvertime } from "../controllers/overtime.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

const router = Router();

router.use(authenticate);
// Writable by the Operation Manager (see field-staff.routes.ts); no denyReadOnlyMutations.
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

router.get("/", listOvertime);
router.post("/", createOvertime);
// Approving or rejecting is the Admin's alone. Fixed path before /:id.
router.put("/decision", authorize("ADMIN"), decideOvertime);
router.put("/:id", updateOvertime);
router.delete("/:id", deleteOvertime);

export default router;
