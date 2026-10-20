import { Router } from "express";
import {
  createRequest,
  getRequest,
  listRequests,
  orderOptions,
  transition,
} from "../controllers/payment-requests.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { PAYMENT_ROLES, REQUESTER_ROLES } from "../utils/payment-workflow";

/**
 * Payment requests. Requesters (CSMs, field staff) raise and follow their own; the Admin
 * and the Cost Control Manager review, pay and close. Who may take each action on which
 * request is decided per request in utils/payment-workflow.ts, not here.
 */
const router = Router();

router.use(authenticate);
router.use(authorize(...PAYMENT_ROLES));

// Fixed paths first, so they are not taken for a request id.
router.get("/order-options", authorize(...REQUESTER_ROLES), orderOptions);

router.get("/", listRequests);
router.post("/", authorize(...REQUESTER_ROLES), createRequest);
router.get("/:id", getRequest);
router.post("/:id/approve", transition("APPROVE"));
router.post("/:id/reject", transition("REJECT"));
router.post("/:id/return", transition("RETURN"));
router.post("/:id/resubmit", transition("RESUBMIT"));
router.post("/:id/cancel", transition("CANCEL"));
router.post("/:id/mark-paid", transition("MARK_PAID"));
router.post("/:id/close", transition("CLOSE"));

export default router;
