import { Router } from "express";
import {
  csmDailyBoard,
  csmJobDetails,
  csmJobs,
  csmOrderOptions,
  csmWeeklyGrid,
  updateCsmJob,
  sendBackJob,
} from "../controllers/work-jobs.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

/**
 * A CSM's view of field jobs. He reads every job on the grid and the board, and updates only
 * his own (work details, linking his order); the controller checks which jobs are his.
 */
const router = Router();

router.use(authenticate);
router.use(authorize("CSM"));

router.get("/", csmJobs);
router.get("/order-options", csmOrderOptions);
router.get("/grid", csmWeeklyGrid);
router.get("/board", csmDailyBoard);
router.get("/:id/details", csmJobDetails);
router.patch("/:id", updateCsmJob);
router.post("/:id/send-back", sendBackJob);

export default router;
