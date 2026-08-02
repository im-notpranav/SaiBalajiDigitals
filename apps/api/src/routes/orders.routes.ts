import { Router, raw } from "express";
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
  markOrderInstalled,
  recordPayment,
} from "../controllers/orders.controller";
import { importTemplate, bulkImportOrders } from "../controllers/import.controller";
import { authenticate, authorize, requireSuperAdmin } from "../middlewares/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/export", authorize("EMPLOYEE", "ADMIN", "ACCOUNTS"), exportOrders);
// Bulk import (super-admin only). `raw` accepts the uploaded .xlsx as the request body.
router.get("/import/template", authorize("ADMIN"), requireSuperAdmin, importTemplate);
router.post("/import", authorize("ADMIN"), requireSuperAdmin, raw({ type: () => true, limit: "10mb" }), bulkImportOrders);
router.get("/", getOrders);
router.get("/:id", getOrder);
router.post("/", authorize("EMPLOYEE", "ADMIN"), createOrder);
router.put("/:id", authorize("EMPLOYEE", "ADMIN"), updateOrder);
router.delete("/:id", authorize("ADMIN"), deleteOrder);
router.put("/:id/install", authorize("EMPLOYEE", "ADMIN"), markOrderInstalled);
router.put("/:id/invoice", authorize("ACCOUNTS", "ADMIN"), reconcileInvoice);
router.put("/:id/payment", authorize("ACCOUNTS", "ADMIN"), recordPayment);
router.put("/:id/close", authorize("ADMIN"), closeOrder);
router.put("/:id/force-close", authorize("ADMIN"), forceCloseOrder);
router.patch("/:orderId/items/:itemId/flag", authorize("EMPLOYEE", "ADMIN"), flagOrderItem);
router.put("/:orderId/items/:itemId/remark", authorize("ADMIN"), setItemLossRemark);
router.patch("/:orderId/items/:itemId/assign", authorize("OPERATOR", "ADMIN"), assignOrderItem);
router.patch("/:orderId/items/:itemId/complete", authorize("PRODUCTION", "OPERATOR", "ADMIN"), completeOrderItem);

export default router;
