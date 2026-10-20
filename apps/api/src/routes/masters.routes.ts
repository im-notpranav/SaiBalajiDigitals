import { Router } from "express";
import {
  listAreas,
  createArea,
  updateArea,
  listVehicles,
  createVehicle,
  updateVehicle,
  listCsmCodes,
  createCsmCode,
  updateCsmCode,
} from "../controllers/masters.controller";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { ALLOCATION_MANAGER_ROLES } from "../utils/roles";

const router = Router();

router.use(authenticate);
// Allocation masters are writable by the Operation Manager (see field-staff.routes.ts).
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

router.get("/areas", listAreas);
router.post("/areas", createArea);
router.patch("/areas/:id", updateArea);

router.get("/vehicles", listVehicles);
router.post("/vehicles", createVehicle);
router.patch("/vehicles/:id", updateVehicle);

router.get("/csm-codes", listCsmCodes);
router.post("/csm-codes", createCsmCode);
router.patch("/csm-codes/:id", updateCsmCode);

export default router;
