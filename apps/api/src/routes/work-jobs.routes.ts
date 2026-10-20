import { Router } from "express";
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  setJobStatus,
  orderOptions,
  dailyBoard,
  weeklyGrid,
} from "../controllers/work-jobs.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

const router = Router();

router.use(authenticate);
// Writable by the Operation Manager (see field-staff.routes.ts); no denyReadOnlyMutations.
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

// Fixed paths first, so they are not taken for a job id.
router.get("/order-options", orderOptions);
router.get("/board", dailyBoard);
router.get("/grid", weeklyGrid);

router.get("/", listJobs);
router.post("/", createJob);
router.get("/:id", getJob);
router.put("/:id", updateJob);
router.put("/:id/status", setJobStatus);

export default router;
