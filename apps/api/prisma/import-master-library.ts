/**
 * Loads a Master Library workbook (Clients, Media, Locations sheets) from the command line,
 * through the same code as Master Library -> Import in the app: same checks, same preview,
 * same writes and audit-log entry. Use it when the file is too big to click through, or to
 * load a database the app is not pointed at.
 *
 *   npm run import:masters -w @sb-oms/api -- "C:\path\to\file.xlsx"           (dry run: prints the preview)
 *   npm run import:masters -w @sb-oms/api -- "C:\path\to\file.xlsx" --apply   (writes)
 *
 * The database is DATABASE_URL: the one in apps/api/.env unless the shell sets it first.
 * The import is recorded against the super administrator. Nothing is ever deleted; names
 * already in the list get their filled columns updated; rows with errors are skipped.
 */
import { readFileSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) throw new Error('Give the .xlsx path: npm run import:masters -w @sb-oms/api -- "C:\\path\\file.xlsx" [--apply]');

  // Quiet Prisma's query log; set before the app modules load.
  process.env.NODE_ENV = "production";
  const { prisma } = await import("../src/utils/prisma");
  const { previewMasterImport, applyMasterImport } = await import("../src/controllers/master-library.controller");

  const host = (process.env.DATABASE_URL ?? "").replace(/^[^@]*@/, "").replace(/[/?].*$/, "");
  console.log(`Database: ${host || "(DATABASE_URL not set)"}`);
  console.log(apply ? "Mode: APPLY (writes)\n" : "Mode: dry run (nothing saved). Add --apply to write.\n");

  const admin = await prisma.user.findFirst({ where: { is_super_admin: true }, select: { id: true, username: true } });
  if (!admin) throw new Error("No super administrator in this database.");

  let status = 200;
  let body: any;
  const req = { body: readFileSync(path), user: { ...admin, role: "ADMIN" } } as any;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  } as any;

  await (apply ? applyMasterImport : previewMasterImport)(req, res);
  if (status !== 200) throw new Error(`${status}: ${body?.message ?? JSON.stringify(body)}`);

  for (const s of body.sheets) {
    if (!s.found) continue;
    console.log(`${s.sheet}: ${s.add} new, ${s.update} updated, ${s.unchanged} unchanged, ${s.error_count} errors${s.problem ? ` (${s.problem})` : ""}`);
    for (const e of s.errors) console.log(`  row ${e.row}: ${e.message}`);
    const updates = s.changes.filter((c: any) => c.action === "update");
    for (const c of updates.slice(0, 40)) console.log(`  update ${c.name}: ${c.detail}`);
    if (updates.length > 40) console.log(`  ...and ${updates.length - 40} more updates`);
  }
  console.log(apply ? "\nSaved." : "\nNothing saved.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
