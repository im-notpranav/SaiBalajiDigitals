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
import { authenticate, authorize, requireSuperAdmin } from "../middlewares/auth.middleware";
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
// Changing the lists themselves is the super admin's (NMG); other admins approve requests and look.
router.post("/duplicates/not-same", requireSuperAdmin, markNotSame);
router.post("/merge", requireSuperAdmin, mergeEntries);

router.get("/template", masterTemplate);
router.get("/export", masterExport);
// The .xlsx arrives as the raw request body; the same file is sent to preview, then to apply.
router.post("/import/preview", requireSuperAdmin, rawUpload(5 * 1024 * 1024, "5 MB"), previewMasterImport);
router.post("/import", requireSuperAdmin, rawUpload(5 * 1024 * 1024, "5 MB"), applyMasterImport);

router.get("/:kind(clients|media|locations)", listEntries);
router.post("/:kind(clients|media|locations)", requireSuperAdmin, createMasterEntry);
router.patch("/:kind(clients|media|locations)/:id", requireSuperAdmin, updateMasterEntry);

export default router;
