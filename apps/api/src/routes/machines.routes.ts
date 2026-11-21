import { Router } from "express";
import {
  changeLineMachine,
  createMachine,
  listMachines,
  machineBoard,
  machineSetup,
  myMachineQueue,
  rejectLine,
  setMediaMachine,
  setOperatorMachine,
  startLine,
  updateMachine,
} from "../controllers/machines.controller";
import { authenticate, authorize, requireSuperAdmin } from "../middlewares/auth.middleware";

/** /api/machines: the machine master. Only the super admin edits it; the PM sets operators' machines. */
export const machinesRouter = Router();
machinesRouter.use(authenticate);
machinesRouter.get("/", listMachines);
machinesRouter.get("/setup", authorize("ADMIN", "PRODUCTION_MANAGER", "OPERATION_MANAGER"), machineSetup);
machinesRouter.post("/", authorize("ADMIN"), requireSuperAdmin, createMachine);
machinesRouter.patch("/:id", authorize("ADMIN"), requireSuperAdmin, updateMachine);
machinesRouter.put("/media/:id", authorize("ADMIN"), requireSuperAdmin, setMediaMachine);
machinesRouter.put("/operators/:id", authorize("ADMIN", "PRODUCTION_MANAGER"), setOperatorMachine);

/** /api/production: the machine queue for operators and the board for the Production Manager. */
export const productionRouter = Router();
productionRouter.use(authenticate);
productionRouter.get("/machine-queue", authorize("PRODUCTION"), myMachineQueue);
productionRouter.post("/lines/:id/start", authorize("PRODUCTION"), startLine);
productionRouter.post("/lines/:id/reject", authorize("PRODUCTION"), rejectLine);
productionRouter.get("/board", authorize("PRODUCTION_MANAGER", "ADMIN"), machineBoard);
productionRouter.patch("/lines/:id/machine", authorize("PRODUCTION_MANAGER", "ADMIN"), changeLineMachine);
