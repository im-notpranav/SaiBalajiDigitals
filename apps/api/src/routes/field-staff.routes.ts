import { Router } from "express";
import {
  listFieldStaff,
  createFieldStaff,
  updateFieldStaff,
  setFieldStaffStatus,
  resetFieldStaffPassword,
  uploadFieldStaffPhoto,
  removeFieldStaffPhoto,
  deleteFieldStaff,
} from "../controllers/field-staff.controller";
import { MAX_PHOTO_BYTES } from "../controllers/users.controller";
import { authenticate, authorize, requireSuperAdmin } from "../middlewares/auth.middleware";
import { rawUpload } from "../middlewares/raw-upload";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

const router = Router();

router.use(authenticate);
// Admins and the Operation Manager see the list. Every change to an account (adding,
// editing, password, photo, switching off, deleting) is the super admin's alone, field
// staff included (decided 2026-11-15). The controller still confines these routes to
// field-staff accounts.
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

router.get("/", listFieldStaff);
router.post("/", requireSuperAdmin, createFieldStaff);
router.patch("/:id", requireSuperAdmin, updateFieldStaff);
router.put("/:id/status", requireSuperAdmin, setFieldStaffStatus);
router.put("/:id/password", requireSuperAdmin, resetFieldStaffPassword);
router.post("/:id/photo", requireSuperAdmin, rawUpload(MAX_PHOTO_BYTES, "512 KB"), uploadFieldStaffPhoto);
router.delete("/:id/photo", requireSuperAdmin, removeFieldStaffPhoto);
router.delete("/:id", requireSuperAdmin, deleteFieldStaff);

export default router;
