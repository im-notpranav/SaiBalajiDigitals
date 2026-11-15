import { Router } from "express";
import {
  applyMasterImport,
  approveNameRequest,
  createMasterEntry,
  createNameRequest,
  listDuplicates,
  listEntries,
  listNameRequests,
  markNotSame,
  masterExport,
  masterTemplate,
  mergeEntries,
  previewMasterImport,
  rejectNameRequest,
  updateMasterEntry,
} from "../controllers/master-library.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { rawUpload } from "../middlewares/raw-upload";

const router = Router();

router.use(authenticate);

// Asking for a missing name is open to the people who fill in orders and jobs. It changes no
// list, so the Operation Manager (view-only elsewhere) may ask too.
router.get("/requests", authorize("ADMIN", "CSM", "OPERATION_MANAGER"), listNameRequests);
router.post("/requests", authorize("ADMIN", "CSM", "OPERATION_MANAGER"), createNameRequest);

// Everything else is the Admin's: only the Admin keeps the official names.
router.use(authorize("ADMIN"));

router.post("/requests/:id/approve", approveNameRequest);
router.post("/requests/:id/reject", rejectNameRequest);

router.get("/duplicates", listDuplicates);
router.post("/duplicates/not-same", markNotSame);
router.post("/merge", mergeEntries);

router.get("/template", masterTemplate);
router.get("/export", masterExport);
// The .xlsx arrives as the raw request body; the same file is sent to preview, then to apply.
router.post("/import/preview", rawUpload(5 * 1024 * 1024, "5 MB"), previewMasterImport);
router.post("/import", rawUpload(5 * 1024 * 1024, "5 MB"), applyMasterImport);

router.get("/:kind(clients|media|locations)", listEntries);
router.post("/:kind(clients|media|locations)", createMasterEntry);
router.patch("/:kind(clients|media|locations)/:id", updateMasterEntry);

export default router;
