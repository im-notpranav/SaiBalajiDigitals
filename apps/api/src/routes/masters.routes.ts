import { Router } from "express";
import {
  listAreas,
  createArea,
  updateArea,
  searchLocations,
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

// The store-location pick-list on orders, so the CSM reaches it too. Ahead of the rule below.
router.get("/locations", authorize("ADMIN", "OPERATION_MANAGER", "CSM"), searchLocations);

// Allocation masters are writable by the Operation Manager (see field-staff.routes.ts).
router.use(authorize(...ALLOCATION_MANAGER_ROLES));

// Areas are the Master Library's Locations: only the admin adds or changes them (Q25).
router.get("/areas", listAreas);
router.post("/areas", authorize("ADMIN"), createArea);
router.patch("/areas/:id", authorize("ADMIN"), updateArea);

router.get("/vehicles", listVehicles);
router.post("/vehicles", createVehicle);
router.patch("/vehicles/:id", updateVehicle);

router.get("/csm-codes", listCsmCodes);
router.post("/csm-codes", createCsmCode);
router.patch("/csm-codes/:id", updateCsmCode);

export default router;
