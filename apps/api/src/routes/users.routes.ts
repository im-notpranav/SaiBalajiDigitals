import { Router } from "express";
import { getUsers, createUser, deleteUser, updateMe, checkUsername, toggleUserStatus, updateUser, getProductionStaff } from "../controllers/users.controller";
import { authenticate, authorize, requireSuperAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/me", (req, res) => res.status(200).json(req.user)); // Should be in auth but keeping for completeness if needed
router.put("/me", updateMe);

router.get("/production-staff", authorize("OPERATOR", "ADMIN"), getProductionStaff);
router.get("/check", authorize("ADMIN"), checkUsername);
router.get("/", authorize("ADMIN"), getUsers);
router.post("/", authorize("ADMIN"), requireSuperAdmin, createUser);
router.delete("/:id", authorize("ADMIN"), deleteUser);
router.put("/:id/status", authorize("ADMIN"), toggleUserStatus);
router.put("/:id", authorize("ADMIN"), requireSuperAdmin, updateUser);

export default router;
