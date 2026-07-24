import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export function decimalToNumber(value: { toString(): string } | null | undefined): number {
  if (value == null) return 0;
  return Number(value.toString());
}

export function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function computeItemFields(width: number, height: number, qty: number, rate: number) {
  const total_sft = round2((width * height / 144) * qty);
  const amount = round2(total_sft * rate);
  return { total_sft, amount };
}

export function deriveYY(date = new Date()): string {
  const month = date.getMonth();
  const year = date.getFullYear();
  const fyStartYear = month >= 4 ? year : year - 1;
  return String(fyStartYear).slice(-2);
}

export async function generateOrderNo(tx: PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) {
  const rows = await tx.$queryRaw<Array<{ id: number; year_code: string; last_number: number }>>`
    SELECT id, year_code, last_number FROM "OrderSequence" WHERE id = 1 FOR UPDATE
  `;
  const seq = rows[0];
  if (!seq) throw new Error("OrderSequence not initialized");

  const currentYY = deriveYY();
  let { year_code, last_number } = seq;
  if (year_code !== currentYY) {
    year_code = currentYY;
    last_number = 0;
  }
  last_number += 1;

  await tx.orderSequence.update({
    where: { id: 1 },
    data: { year_code, last_number },
  });

  return `ORD${year_code}${String(last_number).padStart(4, "0")}`;
}

export async function withAuditUser<T>(
  userId: number,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
    return fn(tx);
  });
}
