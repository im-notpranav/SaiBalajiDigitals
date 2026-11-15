import { Router } from "express";
import { zoneBoard } from "../controllers/zone-board.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

/** The Zone Board: the Admin and the Operation Manager, who run work allocation. */
const router = Router();

router.use(authenticate);
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

router.get("/", zoneBoard);

export default router;
