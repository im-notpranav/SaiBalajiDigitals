import { Router } from "express";
import { addDaySheetEntry, daySheetPeople, deleteDaySheetEntry, getDaySheet, updateDaySheetEntry } from "../controllers/day-sheets.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";

/** Day sheets: everyone writes their own; Admin and OM read anyone's. */
const router = Router();

router.use(authenticate);

router.get("/people", authorize("ADMIN", "OPERATION_MANAGER"), daySheetPeople);
router.get("/", getDaySheet);
router.post("/", addDaySheetEntry);
router.patch("/:id", updateDaySheetEntry);
router.delete("/:id", deleteDaySheetEntry);

export default router;
