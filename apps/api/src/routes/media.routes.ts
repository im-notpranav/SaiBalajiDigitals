import { Router } from "express";
import { searchMedia } from "../controllers/media.controller";
import { authenticate, authorize, denyReadOnlyMutations } from "../middlewares/auth.middleware";
import { OMS_ROLES } from "../utils/roles";

const router = Router();
router.use(authenticate);
router.use(authorize(...OMS_ROLES));
router.use(denyReadOnlyMutations);
router.get("/", searchMedia);

export default router;
