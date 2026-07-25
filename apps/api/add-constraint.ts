import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "chk_closure_reason"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD CONSTRAINT "chk_closure_reason" CHECK ("closure_remark_type" != 'CustomReason' OR ("closure_remark_text" IS NOT NULL AND length(trim("closure_remark_text")) > 0))`);
    console.log("CHECK constraint added successfully!");
  } catch (err) {
    console.error("Error adding constraint:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
