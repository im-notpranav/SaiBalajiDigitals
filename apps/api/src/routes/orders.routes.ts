import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import { clientIpKey } from "../utils/rate-limit";
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderDetails,
  updateStore,
  addStore,
  deleteStore,
  deleteOrder,
  createInvoice,
  recordInvoicePayment,
  editInvoiceBilling,
  editInvoicePayment,
  closeOrder,
  exportOrders,
  forceCloseOrder,
  flagOrderItem,
  setItemLossRemark,
  assignOrderItem,
  completeOrderItem,
  markStoreInstalled,
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
// Header edits are separate from line items: they stay open later in the pipeline, and
// they are not restricted to the CSM who raised the order.
router.patch("/:id/details", authorize("CSM", "ADMIN"), updateOrderDetails);
router.post("/:id/stores", authorize("CSM", "ADMIN"), addStore);
router.patch("/:orderId/stores/:storeId", authorize("CSM", "ADMIN"), updateStore);
router.delete("/:orderId/stores/:storeId", authorize("CSM", "ADMIN"), deleteStore);
router.delete("/:id", authorize("ADMIN"), deleteOrder);
router.put("/:orderId/stores/:storeId/install", authorize("CSM", "ADMIN"), markStoreInstalled);
// An order can carry several invoices, each covering its own set of stores.
router.post("/:id/invoices", authorize("ACCOUNTS", "ADMIN"), createInvoice);
router.put("/:orderId/invoices/:invoiceId/payment", authorize("ACCOUNTS", "ADMIN"), recordInvoicePayment);
router.patch("/:orderId/invoices/:invoiceId/billing", authorize("ACCOUNTS", "ADMIN"), editInvoiceBilling);
router.patch("/:orderId/invoices/:invoiceId/payment-edit", authorize("ACCOUNTS", "ADMIN"), editInvoicePayment);
router.get("/:id/follow-ups", getFollowUps);
router.post("/:id/follow-ups", authorize("CSM", "ACCOUNTS", "ADMIN"), createFollowUp);
router.put("/:id/close", authorize("ADMIN"), closeOrder);
router.put("/:id/force-close", authorize("ADMIN"), forceCloseOrder);
router.patch("/:orderId/items/:itemId/flag", authorize("CSM", "ADMIN"), flagOrderItem);
router.put("/:orderId/items/:itemId/remark", authorize("ADMIN"), setItemLossRemark);
router.patch("/:orderId/items/:itemId/assign", authorize("PRODUCTION_MANAGER", "ADMIN"), assignOrderItem);
router.patch("/:orderId/items/:itemId/complete", authorize("PRODUCTION", "PRODUCTION_MANAGER", "ADMIN"), completeOrderItem);

export default router;
