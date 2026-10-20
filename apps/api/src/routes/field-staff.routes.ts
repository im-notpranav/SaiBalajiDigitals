import { Router } from "express";
import {
  listFieldStaff,
  createFieldStaff,
  updateFieldStaff,
  setFieldStaffStatus,
  resetFieldStaffPassword,
} from "../controllers/field-staff.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

const router = Router();

router.use(authenticate);
// No denyReadOnlyMutations here, on purpose: running the work-allocation portal is the
// one place the Operation Manager may write. The controller confines every write to
// field-staff accounts.
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

router.get("/", listFieldStaff);
router.post("/", createFieldStaff);
router.patch("/:id", updateFieldStaff);
router.put("/:id/status", setFieldStaffStatus);
router.put("/:id/password", resetFieldStaffPassword);

export default router;
