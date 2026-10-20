import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { areaSchema, vehicleSchema, csmCodeSchema } from "../utils/validators";
import { sanitizeZodErrors } from "../utils/sanitize-errors";

/**
 * Masters for the work-allocation portal: CSM codes, areas and vehicles.
 *
 * Every update runs in a transaction that sets app.current_user_id first, so the audit
 * trigger on each table attributes the change (see migration 20261020000000).
 */

const parseId = (req: Request) => {
  const id = parseInt(req.params.id as string, 10);
  return Number.isInteger(id) ? id : null;
};

const activeFilter = (req: Request) => (req.query.active === "true" ? { is_active: true } : {});

function handleError(res: Response, err: any, uniqueMessage: string) {
  if (err?.code === "P2002") return res.status(400).json({ message: uniqueMessage });
  if (err?.code === "P2025") return res.status(404).json({ message: "Not found" });
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Internal server error" });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function withAudit<T>(userId: number, fn: (tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId.toString()}, true)`;
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/** Names are compared case-insensitively so "Ameerpet" and "ameerpet" cannot coexist. */
async function assertAreaNameFree(tx: any, name: string, exceptId?: number) {
  const clash = await tx.area.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (clash && clash.id !== exceptId) throw new HttpError(400, `Area "${clash.name}" already exists.`);
}

export const listAreas = async (req: Request, res: Response) => {
  try {
    const areas = await prisma.area.findMany({ where: activeFilter(req), orderBy: { name: "asc" } });
    return res.status(200).json({ areas });
  } catch (err) {
    return handleError(res, err, "");
  }
};

export const createArea = async (req: Request, res: Response) => {
  const parsed = areaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
  try {
    const area = await withAudit(req.user!.id, async (tx) => {
      await assertAreaNameFree(tx, parsed.data.name);
      return tx.area.create({ data: parsed.data });
    });
    return res.status(201).json(area);
  } catch (err) {
    return handleError(res, err, "That area already exists.");
  }
};

export const updateArea = async (req: Request, res: Response) => {
  const id = parseId(req);
  if (id == null) return res.status(400).json({ message: "Invalid id" });
  const parsed = areaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
  try {
    const area = await withAudit(req.user!.id, async (tx) => {
      if (parsed.data.name) await assertAreaNameFree(tx, parsed.data.name, id);
      return tx.area.update({ where: { id }, data: parsed.data });
    });
    return res.status(200).json(area);
  } catch (err) {
    return handleError(res, err, "That area already exists.");
  }
};

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

const vehicleInclude = { usualDriver: { select: { id: true, name: true } } } as const;

async function assertDriver(tx: any, userId: number | null | undefined) {
  if (userId == null) return;
  const driver = await tx.user.findUnique({ where: { id: userId }, select: { role: true, is_active: true } });
  if (!driver || driver.role !== "DRIVER" || !driver.is_active) {
    throw new HttpError(400, "The usual driver must be an active user with the Driver role.");
  }
}

export const listVehicles = async (req: Request, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({ where: activeFilter(req), include: vehicleInclude, orderBy: { reg_no: "asc" } });
    return res.status(200).json({ vehicles });
  } catch (err) {
    return handleError(res, err, "");
  }
};

export const createVehicle = async (req: Request, res: Response) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
  try {
    const vehicle = await withAudit(req.user!.id, async (tx) => {
      await assertDriver(tx, parsed.data.usual_driver_id);
      return tx.vehicle.create({ data: parsed.data, include: vehicleInclude });
    });
    return res.status(201).json(vehicle);
  } catch (err) {
    return handleError(res, err, "A vehicle with that registration number already exists.");
  }
};

export const updateVehicle = async (req: Request, res: Response) => {
  const id = parseId(req);
  if (id == null) return res.status(400).json({ message: "Invalid id" });
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
  try {
    const vehicle = await withAudit(req.user!.id, async (tx) => {
      await assertDriver(tx, parsed.data.usual_driver_id);
      return tx.vehicle.update({ where: { id }, data: parsed.data, include: vehicleInclude });
    });
    return res.status(200).json(vehicle);
  } catch (err) {
    return handleError(res, err, "A vehicle with that registration number already exists.");
  }
};

// ---------------------------------------------------------------------------
// CSM codes
// ---------------------------------------------------------------------------

const csmCodeInclude = { user: { select: { id: true, name: true, username: true } } } as const;

/** A code of kind CSM points at a CSM user; any other kind must not point at a user. */
async function assertCodeOwner(tx: any, kind: string | undefined, userId: number | null | undefined) {
  if (kind !== undefined && kind !== "CSM" && userId != null) {
    throw new HttpError(400, "Only a code of kind CSM can be linked to a user.");
  }
  if (userId == null) return;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "CSM") throw new HttpError(400, "A CSM code can only be linked to a user with the CSM role.");
}

export const listCsmCodes = async (req: Request, res: Response) => {
  try {
    const codes = await prisma.csmCode.findMany({ where: activeFilter(req), include: csmCodeInclude, orderBy: { code: "asc" } });
    return res.status(200).json({ codes });
  } catch (err) {
    return handleError(res, err, "");
  }
};

export const createCsmCode = async (req: Request, res: Response) => {
  const parsed = csmCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
  try {
    const code = await withAudit(req.user!.id, async (tx) => {
      await assertCodeOwner(tx, parsed.data.kind, parsed.data.user_id);
      return tx.csmCode.create({ data: parsed.data, include: csmCodeInclude });
    });
    return res.status(201).json(code);
  } catch (err) {
    return handleError(res, err, "That code already exists.");
  }
};

export const updateCsmCode = async (req: Request, res: Response) => {
  const id = parseId(req);
  if (id == null) return res.status(400).json({ message: "Invalid id" });
  const parsed = csmCodeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid input", errors: sanitizeZodErrors(parsed.error) });
  try {
    const code = await withAudit(req.user!.id, async (tx) => {
      const current = await tx.csmCode.findUnique({ where: { id } });
      if (!current) throw new HttpError(404, "Not found");
      const kind = parsed.data.kind ?? current.kind;
      // Changing a code away from CSM drops its user link rather than leaving a contradiction.
      const user_id = kind === "CSM" ? (parsed.data.user_id !== undefined ? parsed.data.user_id : current.user_id) : null;
      await assertCodeOwner(tx, kind, user_id);
      return tx.csmCode.update({ where: { id }, data: { ...parsed.data, user_id }, include: csmCodeInclude });
    });
    return res.status(200).json(code);
  } catch (err) {
    return handleError(res, err, "That code already exists.");
  }
};
