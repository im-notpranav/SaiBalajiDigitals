import { Router } from "express";
import { getAllocationSheet, updateAllocationSheet } from "../controllers/allocation-sheet.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

/** The link behind Work Allocation's Sheet View. Read by everyone signed in; set by the Admin. */
const router = Router();

router.use(authenticate);

router.get("/", getAllocationSheet);
router.put("/", authorize("ADMIN"), updateAllocationSheet);

export default router;
