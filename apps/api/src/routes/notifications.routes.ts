import { Router } from "express";
import { getMyNotifications, markAllAsRead, markOneAsRead } from "../controllers/notifications.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// Every route here is the user's own inbox, so the Operation Manager's read-only rule
// (which guards business records) does not apply.
router.use(authenticate);

router.get("/", getMyNotifications);
router.put("/read-all", markAllAsRead);
router.put("/:id/read", markOneAsRead);

export default router;
