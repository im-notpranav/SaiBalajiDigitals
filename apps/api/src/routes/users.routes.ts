import { Router } from "express";
import { getUsers, createUser, deleteUser, updateMe, checkUsername } from "../controllers/users.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/me", (req, res) => res.status(200).json(req.user)); // Should be in auth but keeping for completeness if needed
router.put("/me", updateMe);

router.get("/check", authorize("ADMIN"), checkUsername);
router.get("/", authorize("ADMIN"), getUsers);
router.post("/", authorize("ADMIN"), createUser);
router.delete("/:id", authorize("ADMIN"), deleteUser);

export default router;
