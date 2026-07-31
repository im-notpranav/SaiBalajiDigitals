import { Router } from "express";
import { searchMedia } from "../controllers/media.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();
router.use(authenticate);
router.get("/", searchMedia);

export default router;
