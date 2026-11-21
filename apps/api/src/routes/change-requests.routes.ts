import { Router } from "express";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { approveChangeRequest, cancelChangeRequest, changeRequestCount, changeRequestQueue, rejectChangeRequest } from "../controllers/change-requests.controller";

/** The admin's Change Requests queue, and a CSM withdrawing their own request. */
const router = Router();
router.use(authenticate);
router.get("/", authorize("ADMIN", "OPERATION_MANAGER"), changeRequestQueue);
router.get("/count", authorize("ADMIN"), changeRequestCount);
router.post("/:id/approve", authorize("ADMIN"), approveChangeRequest);
router.post("/:id/reject", authorize("ADMIN"), rejectChangeRequest);
router.post("/:id/cancel", authorize("CSM", "ADMIN"), cancelChangeRequest);

export default router;
