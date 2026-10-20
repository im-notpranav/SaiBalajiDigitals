/**
 * One-time import of field staff (Pasters, Helpers, Drivers) from the "Employees" sheet of
 * the SBD Smart Work Allocation workbook. Each person becomes a login with a generated
 * temporary password.
 *
 *   npm run import:field-staff -w @sb-oms/api -- "C:\path\to\SBD_Smart_Work_Allocation.xlsx"          (dry run)
 *   npm run import:field-staff -w @sb-oms/api -- "C:\path\to\SBD_Smart_Work_Allocation.xlsx" --apply  (writes)
 *
 * A dry run only prints what would happen. --apply creates the users and writes their
 * usernames and temporary passwords to prisma/private/field-staff-credentials-<date>.csv.
 * That file is git-ignored: hand each person their login, then delete it.
 *
 * Re-running is safe. Anyone whose name already belongs to a field-staff user, or whose
 * employee code is already taken, is skipped.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();
const ROLE_MAP: Record<string, "PASTER" | "HELPER" | "DRIVER"> = {
  paster: "PASTER",
  helper: "HELPER",
  "ast. paster": "HELPER",
  "sub-paster": "HELPER",
  driver: "DRIVER",
};

/** Ten characters without look-alikes (0/O, 1/l/I), easy to read out over the phone. */
function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

const baseUsername = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 44) || "staff";

/** 10-digit Indian mobile → +91XXXXXXXXXX, anything else → null (fix it in the app later). */
function normalisePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  if (!file) throw new Error("Pass the path to SBD_Smart_Work_Allocation.xlsx");

  const sheet = XLSX.readFile(file).Sheets["Employees"];
  if (!sheet) throw new Error('The workbook has no "Employees" sheet.');
  // Row 4 holds the headers; the two rows above it are instructions.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 3, defval: null });

  const existing = await prisma.user.findMany({ select: { name: true, username: true, role: true, emp_code: true } });
  const fieldNames = new Set(existing.filter((u) => ["PASTER", "HELPER", "DRIVER"].includes(u.role)).map((u) => u.name.toLowerCase()));
  const usernames = new Set(existing.map((u) => u.username.toLowerCase()));
  const empCodes = new Set(existing.map((u) => u.emp_code).filter(Boolean) as string[]);

  const toCreate: { name: string; username: string; password: string; role: "PASTER" | "HELPER" | "DRIVER"; phone: string | null; emp_code: string | null }[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const name = String(row["Name (as used daily)"] ?? "").trim();
    if (!name) continue;
    const role = ROLE_MAP[String(row["Role"] ?? "").trim().toLowerCase()];
    if (!role) { skipped.push(`${name}: unknown role "${row["Role"]}"`); continue; }
    if (String(row["Active?"] ?? "Yes").trim().toLowerCase() === "no") { skipped.push(`${name}: marked inactive`); continue; }
    if (fieldNames.has(name.toLowerCase())) { skipped.push(`${name}: already a field-staff user`); continue; }

    let emp_code = row["Emp Code"] != null ? String(row["Emp Code"]).trim() || null : null;
    if (emp_code && empCodes.has(emp_code)) { skipped.push(`${name}: emp code ${emp_code} already used (imported without a code)`); emp_code = null; }

    let username = baseUsername(name);
    for (let n = 2; usernames.has(username); n++) username = `${baseUsername(name)}_${n}`;
    usernames.add(username);
    fieldNames.add(name.toLowerCase());
    if (emp_code) empCodes.add(emp_code);

    toCreate.push({ name, username, password: tempPassword(), role, phone: normalisePhone(row["WhatsApp No"]), emp_code });
  }

  console.log(`${toCreate.length} to create, ${skipped.length} skipped.`);
  for (const s of skipped) console.log(`  skip  ${s}`);
  for (const u of toCreate) console.log(`  ${apply ? "create" : "would create"}  ${u.role.padEnd(6)} ${u.name} (@${u.username})${u.emp_code ? ` code ${u.emp_code}` : ""}${u.phone ? "" : " — no phone"}`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to create these users.");
    return;
  }
  if (toCreate.length === 0) return;

  // Hash first: bcrypt at cost 12 takes ~100 ms each, far too slow to do inside a
  // transaction. A single createMany is then atomic on its own — all or nothing.
  const data = await Promise.all(
    toCreate.map(async (u) => ({
      name: u.name,
      username: u.username,
      password: await bcrypt.hash(u.password, 12),
      role: u.role,
      phone: u.phone,
      emp_code: u.emp_code,
    })),
  );
  await prisma.user.createMany({ data });

  const dir = join(__dirname, "private");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `field-staff-credentials-${new Date().toISOString().slice(0, 10)}.csv`);
  const csv = ["name,username,temporary_password,role", ...toCreate.map((u) => `"${u.name.replace(/"/g, '""')}",${u.username},${u.password},${u.role}`)].join("\n");
  writeFileSync(out, csv + "\n", { mode: 0o600 });
  console.log(`\nCreated ${toCreate.length} users. Logins written to ${out} — share them, then delete the file.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
