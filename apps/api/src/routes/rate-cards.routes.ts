import { Router } from "express";
import {
  approveRateCard,
  createRateCard,
  deleteRateCard,
  exportRateCards,
  importRateCards,
  listRateCards,
  lookupRates,
  rateCardCount,
  rateCardTemplate,
  rejectRateCard,
  updateRateCard,
} from "../controllers/rate-cards.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { rawUpload } from "../middlewares/raw-upload";

const router = Router();

router.use(authenticate);

// CSMs see the rate cards, price their order lines from them and ask for new ones.
router.get("/", authorize("ADMIN", "CSM", "OPERATION_MANAGER"), listRateCards);
router.get("/lookup", authorize("ADMIN", "CSM"), lookupRates);
router.get("/export", authorize("ADMIN", "CSM", "OPERATION_MANAGER"), exportRateCards);
router.post("/", authorize("ADMIN", "CSM"), createRateCard);

// Approving, editing and uploading are the admin's.
router.use(authorize("ADMIN"));
router.get("/count", rateCardCount);
router.get("/template", rateCardTemplate);
router.post("/import", rawUpload(5 * 1024 * 1024, "5 MB"), importRateCards);
router.patch("/:id", updateRateCard);
router.delete("/:id", deleteRateCard);
router.post("/:id/approve", approveRateCard);
router.post("/:id/reject", rejectRateCard);

export default router;
