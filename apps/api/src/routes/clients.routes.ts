import { Router } from "express";
import { searchClients } from "../controllers/clients.controller";
import { authenticate , denyReadOnlyMutations } from "../middlewares/auth.middleware";

const router = Router();
router.use(authenticate);
router.use(denyReadOnlyMutations);
router.get("/", searchClients);

export default router;
