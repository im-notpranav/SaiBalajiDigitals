import { Router } from "express";
import { searchClients } from "../controllers/clients.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();
router.use(authenticate);
router.get("/", searchClients);

export default router;
