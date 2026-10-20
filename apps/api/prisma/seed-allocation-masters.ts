/**
 * Seed the work-allocation masters: the 113 areas and 18 CSM codes from the old
 * "SBD Smart Work Allocation" workbook (see allocation_masters_seed.json).
 *
 * Insert-only and safe to re-run: an area or code that already exists is left exactly as
 * it is, so edits made in the app (a confirmed locality, a linked CSM) are never undone.
 *
 *   npm run db:seed:allocation -w @sb-oms/api
 */
import { PrismaClient, type AreaLocality } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

interface SeedFile {
  areas: { name: string; locality: AreaLocality; needs_confirmation: boolean }[];
  csm_codes: string[];
}

async function main() {
  const seed: SeedFile = JSON.parse(readFileSync(join(__dirname, "allocation_masters_seed.json"), "utf8"));

  const existingAreas = await prisma.area.findMany({ select: { name: true } });
  const haveArea = new Set(existingAreas.map((a) => a.name.toLowerCase()));
  const newAreas = seed.areas.filter((a) => !haveArea.has(a.name.toLowerCase()));
  if (newAreas.length) await prisma.area.createMany({ data: newAreas });

  const existingCodes = await prisma.csmCode.findMany({ select: { code: true } });
  const haveCode = new Set(existingCodes.map((c) => c.code.toUpperCase()));
  // Nobody has said yet which codes are CSMs, teams or branches, so they start UNKNOWN
  // and the masters page flags them for confirmation.
  const newCodes = seed.csm_codes
    .map((c) => c.trim().toUpperCase())
    .filter((c) => !haveCode.has(c))
    .map((code) => ({ code, kind: "UNKNOWN" as const }));
  if (newCodes.length) await prisma.csmCode.createMany({ data: newCodes });

  console.log(
    `Areas: ${newAreas.length} added, ${seed.areas.length - newAreas.length} already present. ` +
      `CSM codes: ${newCodes.length} added, ${seed.csm_codes.length - newCodes.length} already present.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
