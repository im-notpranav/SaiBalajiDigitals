import { Router } from "express";
import { searchMedia } from "../controllers/media.controller";
import { authenticate , denyReadOnlyMutations } from "../middlewares/auth.middleware";

const router = Router();
router.use(authenticate);
router.use(denyReadOnlyMutations);
router.get("/", searchMedia);

export default router;
