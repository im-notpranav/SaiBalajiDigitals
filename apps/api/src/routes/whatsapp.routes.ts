import { Router } from "express";
import { listMessages, receiveWebhook, retryMessage, setupInfo, verifyWebhook } from "../controllers/whatsapp.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

/** The WhatsApp delivery log and setup page: Admin only. */
const router = Router();
router.use(authenticate);
router.use(authorize("ADMIN"));
router.get("/setup", setupInfo);
router.get("/messages", listMessages);
router.post("/messages/:id/retry", retryMessage);
export default router;

/**
 * AskEva calls these, not a person, so there is no login: the GET handshake checks the
 * verify token and every POST must carry ?key= matching ASKEVA_WEBHOOK_SECRET.
 */
export const webhookRouter = Router();
webhookRouter.get("/askeva", verifyWebhook);
webhookRouter.post("/askeva", receiveWebhook);
