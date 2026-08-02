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
  forceCloseOrder,
  flagOrderItem,
  setItemLossRemark,
  assignOrderItem,
  completeOrderItem,
  recordPayment,
} from "../controllers/orders.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/export", authorize("EMPLOYEE", "ADMIN", "ACCOUNTS"), exportOrders);
router.get("/", getOrders);
router.get("/:id", getOrder);
router.post("/", authorize("EMPLOYEE", "ADMIN"), createOrder);
router.put("/:id", authorize("EMPLOYEE", "ADMIN"), updateOrder);
router.delete("/:id", authorize("ADMIN"), deleteOrder);
router.put("/:id/invoice", authorize("ACCOUNTS", "ADMIN"), reconcileInvoice);
router.put("/:id/payment", authorize("ACCOUNTS", "ADMIN"), recordPayment);
router.put("/:id/close", authorize("ADMIN"), closeOrder);
router.put("/:id/force-close", authorize("ADMIN"), forceCloseOrder);
router.patch("/:orderId/items/:itemId/flag", authorize("EMPLOYEE", "ADMIN"), flagOrderItem);
router.put("/:orderId/items/:itemId/remark", authorize("ADMIN"), setItemLossRemark);
router.patch("/:orderId/items/:itemId/assign", authorize("OPERATOR", "ADMIN"), assignOrderItem);
router.patch("/:orderId/items/:itemId/complete", authorize("PRODUCTION", "OPERATOR", "ADMIN"), completeOrderItem);

export default router;
