import { Router } from "express";
import { getUsers, createUser, deleteUser, updateMe, checkUsername, toggleUserStatus, updateUser, getProductionStaff, resetUserPassword } from "../controllers/users.controller";
import { authenticate, authorize, requireSuperAdmin , denyReadOnlyMutations } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(denyReadOnlyMutations);

router.get("/me", (req, res) => res.status(200).json(req.user)); // Should be in auth but keeping for completeness if needed
router.put("/me", updateMe);

router.get("/production-staff", authorize("PRODUCTION_MANAGER", "ADMIN"), getProductionStaff);
router.get("/check", authorize("ADMIN"), checkUsername);
router.get("/", authorize("ADMIN", "OPERATION_MANAGER"), getUsers);
router.post("/", authorize("ADMIN"), requireSuperAdmin, createUser);
router.delete("/:id", authorize("ADMIN"), deleteUser);
router.put("/:id/status", authorize("ADMIN"), toggleUserStatus);
router.put("/:id", authorize("ADMIN"), requireSuperAdmin, updateUser);
router.put("/:id/password", authorize("ADMIN"), requireSuperAdmin, resetUserPassword);

export default router;
