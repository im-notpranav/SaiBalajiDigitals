import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import { clientIpKey } from "../utils/rate-limit";
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
  editBilling,
  editPayment,
  getFollowUps,
  createFollowUp,
  emailExport,
  getRecentRecipients,
  lineItemTemplate,
} from "../controllers/orders.controller";
import { importTemplate, bulkImportOrders } from "../controllers/import.controller";
import { authenticate, authorize, requireSuperAdmin , denyReadOnlyMutations } from "../middlewares/auth.middleware";

const router = Router();

// Tighter limit on email export: 15 emails per 15 minutes per IP
const emailExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: clientIpKey,
  message: { message: "Email export limit reached. Please try again later." },
});

router.use(authenticate);
router.use(denyReadOnlyMutations);

router.get("/export", authorize("CSM", "ADMIN", "OPERATION_MANAGER", "ACCOUNTS"), exportOrders);
router.post("/export/email", authorize("CSM", "ADMIN", "OPERATION_MANAGER", "ACCOUNTS"), emailExportLimiter, emailExport);
router.get("/export/recipients", authorize("CSM", "ADMIN", "OPERATION_MANAGER", "ACCOUNTS"), getRecentRecipients);
router.get("/line-item-template", authorize("CSM", "ADMIN"), lineItemTemplate);
// Bulk import (super-admin only). `raw` accepts the uploaded .xlsx as the request body.
router.get("/import/template", authorize("ADMIN"), requireSuperAdmin, importTemplate);
router.post("/import", authorize("ADMIN"), requireSuperAdmin, raw({ type: () => true, limit: "10mb" }), bulkImportOrders);
router.get("/", getOrders);
router.get("/:id", getOrder);
router.post("/", authorize("CSM", "ADMIN"), createOrder);
router.put("/:id", authorize("CSM", "ADMIN"), updateOrder);
router.delete("/:id", authorize("ADMIN"), deleteOrder);
router.put("/:id/install", authorize("CSM", "ADMIN"), markOrderInstalled);
router.put("/:id/invoice", authorize("ACCOUNTS", "ADMIN"), reconcileInvoice);
router.put("/:id/payment", authorize("ACCOUNTS", "ADMIN"), recordPayment);
router.patch("/:id/billing", authorize("ACCOUNTS", "ADMIN"), editBilling);
router.patch("/:id/payment-edit", authorize("ACCOUNTS", "ADMIN"), editPayment);
router.get("/:id/follow-ups", getFollowUps);
router.post("/:id/follow-ups", authorize("CSM", "ACCOUNTS", "ADMIN"), createFollowUp);
router.put("/:id/close", authorize("ADMIN"), closeOrder);
router.put("/:id/force-close", authorize("ADMIN"), forceCloseOrder);
router.patch("/:orderId/items/:itemId/flag", authorize("CSM", "ADMIN"), flagOrderItem);
router.put("/:orderId/items/:itemId/remark", authorize("ADMIN"), setItemLossRemark);
router.patch("/:orderId/items/:itemId/assign", authorize("PRODUCTION_MANAGER", "ADMIN"), assignOrderItem);
router.patch("/:orderId/items/:itemId/complete", authorize("PRODUCTION", "PRODUCTION_MANAGER", "ADMIN"), completeOrderItem);

export default router;
