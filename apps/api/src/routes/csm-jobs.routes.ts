import { Router } from "express";
import { csmJobs, csmOrderOptions, updateCsmJob } from "../controllers/work-jobs.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

/** A CSM's view of field jobs: only ever the jobs they are the CSM for. */
const router = Router();

router.use(authenticate);
router.use(authorize("CSM"));

router.get("/", csmJobs);
router.get("/order-options", csmOrderOptions);
router.patch("/:id", updateCsmJob);

export default router;
