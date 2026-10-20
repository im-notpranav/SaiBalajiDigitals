import { Router } from "express";
import { searchClients } from "../controllers/clients.controller";
import { authenticate, authorize, denyReadOnlyMutations } from "../middlewares/auth.middleware";
import { OMS_ROLES } from "../utils/roles";

const router = Router();
router.use(authenticate);
router.use(authorize(...OMS_ROLES));
router.use(denyReadOnlyMutations);
router.get("/", searchClients);

export default router;
