import { Router } from "express";
import { getMyNotifications, markAllAsRead, markOneAsRead } from "../controllers/notifications.controller";
import { authenticate , denyReadOnlyMutations } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);
router.use(denyReadOnlyMutations);

router.get("/", getMyNotifications);
router.put("/read-all", markAllAsRead);
router.put("/:id/read", markOneAsRead);

export default router;
