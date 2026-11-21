import { Router } from "express";
import { getCsmDirectory, getUsers, createUser, deleteUser, updateMe, checkUsername, toggleUserStatus, updateUser, getProductionStaff, resetUserPassword, uploadUserPhoto, removeUserPhoto, getUserPhoto, MAX_PHOTO_BYTES } from "../controllers/users.controller";
import { authenticate, authorize, requireSuperAdmin , denyReadOnlyMutations } from "../middlewares/auth.middleware";
import { rawUpload } from "../middlewares/raw-upload";

const router = Router();

router.use(authenticate);

router.get("/me", (req, res) => res.status(200).json(req.user)); // Should be in auth but keeping for completeness if needed
// Self-service sits ahead of the read-only rule: the Operation Manager may still change
// their own profile and password, as every user can. Pictures are the admin's to set, so
// there is no self-upload.
router.put("/me", updateMe);
router.get("/:id/photo", getUserPhoto);
// Every signed-in role shows "CSM name / code" beside order numbers, so this is open to all.
router.get("/csm-directory", getCsmDirectory);

router.use(denyReadOnlyMutations);

router.get("/production-staff", authorize("PRODUCTION_MANAGER", "ADMIN"), getProductionStaff);
router.get("/check", authorize("ADMIN"), checkUsername);
router.get("/", authorize("ADMIN", "OPERATION_MANAGER"), getUsers);
router.post("/", authorize("ADMIN"), requireSuperAdmin, createUser);
// Removing or switching off an account is the super admin's, like creating one (D-01).
// Field staff are managed separately, under /field-staff.
router.delete("/:id", authorize("ADMIN"), requireSuperAdmin, deleteUser);
router.put("/:id/status", authorize("ADMIN"), requireSuperAdmin, toggleUserStatus);
router.put("/:id", authorize("ADMIN"), requireSuperAdmin, updateUser);
router.put("/:id/password", authorize("ADMIN"), requireSuperAdmin, resetUserPassword);
// A picture is part of editing the person, so it follows the same rule as PUT /:id.
router.post("/:id/photo", authorize("ADMIN"), requireSuperAdmin, rawUpload(MAX_PHOTO_BYTES, "512 KB"), uploadUserPhoto);
router.delete("/:id/photo", authorize("ADMIN"), requireSuperAdmin, removeUserPhoto);

export default router;
