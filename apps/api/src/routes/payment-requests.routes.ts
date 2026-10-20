import express, { Router, type NextFunction, type Request, type Response } from "express";
import {
  createRequest,
  downloadAttachment,
  getRequest,
  listRequests,
  orderOptions,
  removeAttachment,
  transition,
  uploadAttachment,
} from "../controllers/payment-requests.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { PAYMENT_ROLES, REQUESTER_ROLES } from "../utils/payment-workflow";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "../utils/payment-files";

/**
 * Payment requests. Requesters (CSMs, field staff) raise and follow their own; the Admin
 * and the Cost Control Manager review, pay and close. Who may take each action on which
 * request is decided per request in utils/payment-workflow.ts, not here.
 */
const router = Router();

router.use(authenticate);
router.use(authorize(...PAYMENT_ROLES));

/** Reads an upload as raw bytes, answering in JSON (not Express's HTML page) when it is too big. */
const parseUpload = (req: Request, res: Response, next: NextFunction) =>
  express.raw({ type: () => true, limit: MAX_FILE_BYTES })(req, res, (err?: any) => {
    if (!err) return next();
    if (err.type === "entity.too.large") return res.status(413).json({ message: `Files can be up to ${MAX_FILE_LABEL}.` });
    return res.status(400).json({ message: "Could not read the file." });
  });

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

router.post("/:id/attachments", parseUpload, uploadAttachment);
router.get("/:id/attachments/:fileId", downloadAttachment);
router.delete("/:id/attachments/:fileId", removeAttachment);

export default router;
