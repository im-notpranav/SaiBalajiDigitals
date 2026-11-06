import { Router } from "express";
import { getUsers, createUser, deleteUser, updateMe, checkUsername, toggleUserStatus, updateUser, getProductionStaff, resetUserPassword, uploadMyPhoto, removeMyPhoto, getUserPhoto } from "../controllers/users.controller";
import { authenticate, authorize, requireSuperAdmin , denyReadOnlyMutations } from "../middlewares/auth.middleware";
import { rawUpload } from "../middlewares/raw-upload";

/** Browsers shrink a picture to a few KB before sending it; this only stops abuse. */
const MAX_PHOTO_BYTES = 512 * 1024;

const router = Router();

router.use(authenticate);

router.get("/me", (req, res) => res.status(200).json(req.user)); // Should be in auth but keeping for completeness if needed
// Self-service sits ahead of the read-only rule: the Operation Manager may still change
// their own profile and password, as every user can.
router.put("/me", updateMe);
router.post("/me/photo", rawUpload(MAX_PHOTO_BYTES, "512 KB"), uploadMyPhoto);
router.delete("/me/photo", removeMyPhoto);
router.get("/:id/photo", getUserPhoto);

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

export default router;
