import { Router } from "express";
import { getMyNotifications, markAllAsRead } from "../controllers/notifications.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getMyNotifications);
router.put("/read-all", markAllAsRead);

export default router;
