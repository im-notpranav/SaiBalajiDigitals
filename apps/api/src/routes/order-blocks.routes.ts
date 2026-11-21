import { Router } from "express";
import {
  approveException,
  checkBlock,
  exceptionCount,
  listBlockSettings,
  listExceptions,
  rejectException,
  requestException,
  updateBlockSettings,
  withdrawException,
} from "../controllers/order-blocks.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/check", authorize("ADMIN", "CSM", "OPERATION_MANAGER"), checkBlock);
router.get("/exceptions", authorize("ADMIN", "CSM"), listExceptions);
router.post("/exceptions", authorize("CSM"), requestException);
router.get("/exceptions/count", authorize("ADMIN"), exceptionCount);
router.post("/exceptions/:id/approve", authorize("ADMIN"), approveException);
router.post("/exceptions/:id/reject", authorize("ADMIN"), rejectException);
router.delete("/exceptions/:id", authorize("CSM"), withdrawException);
// Block settings are any admin's, not only the super admin's: they are a credit decision.
router.get("/clients", authorize("ADMIN"), listBlockSettings);
router.put("/clients/:id", authorize("ADMIN"), updateBlockSettings);

export default router;
