/**
 * Adds one more super admin, leaving any existing super admin untouched.
 *
 *   $env:DATABASE_URL = "<Neon direct url>"
 *   $env:NEW_ADMIN_PASSWORD = Read-Host -MaskInput "Password"
 *   npx tsx prisma/add-super-admin.ts --name "Full Name" --username abc123
 *
 * The password is read from NEW_ADMIN_PASSWORD so it never appears in shell history or a file.
 * Raw SQL on purpose: it touches only columns that have existed since 20261110, so it works even
 * if newer migrations are not on the target database yet.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PASSWORD_HASH_ROUNDS } from "../src/utils/passwords";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name")?.trim();
  const username = arg("--username")?.trim().toUpperCase();
  const password = process.env.NEW_ADMIN_PASSWORD;

  if (!name || !username) throw new Error('Usage: --name "Full Name" --username abc123');
  if (!password || password.length < 8) throw new Error("Set NEW_ADMIN_PASSWORD (8+ characters).");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");

  const host = new URL(process.env.DATABASE_URL).host;
  console.log(`Database: ${host}`);

  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    await prisma.$transaction(async (tx) => {
      const taken = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "User" WHERE username = ${username}`;
      if (taken.length) throw new Error(`Username ${username} already exists (id ${taken[0].id}). Nothing changed.`);

      // Same as migration 20261115120000_allow_multiple_super_admins.
      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS idx_single_super_admin`);

      await tx.$executeRaw`
        INSERT INTO "User" (name, username, password, role, is_super_admin, is_active, password_changed_at, updated_at)
        VALUES (${name}, ${username}, ${hash}, 'ADMIN'::"Role", TRUE, TRUE, NOW(), NOW())`;
    });

    const supers = await prisma.$queryRaw<{ id: number; name: string; username: string }[]>`
      SELECT id, name, username FROM "User" WHERE is_super_admin = TRUE AND deleted_at IS NULL ORDER BY id`;
    console.log(`Added ${username}. Super admins now:`);
    for (const s of supers) console.log(`  #${s.id}  ${s.username}  (${s.name})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
