import { Router } from "express";
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  reconcileInvoice,
  closeOrder,
  exportOrders,
  advanceOrder,
  forceCloseOrder,
} from "../controllers/orders.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/export", authorize("EMPLOYEE", "ADMIN", "ACCOUNTS", "PRODUCTION"), exportOrders);
router.get("/", getOrders);
router.get("/:id", getOrder);
router.post("/", authorize("EMPLOYEE", "ADMIN"), createOrder);
router.put("/:id", authorize("EMPLOYEE", "ADMIN"), updateOrder);
router.delete("/:id", authorize("ADMIN"), deleteOrder);
router.put("/:id/invoice", authorize("ACCOUNTS", "ADMIN"), reconcileInvoice);
router.put("/:id/close", authorize("ADMIN", "ACCOUNTS"), closeOrder);
router.put("/:id/force-close", authorize("ADMIN"), forceCloseOrder);
router.put("/:id/advance", authorize("PRODUCTION", "ADMIN"), advanceOrder);

export default router;
