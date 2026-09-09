import { prisma } from "./prisma";

/**
 * The financial year code used in ORD{YY}{NNNN}.
 *
 * The FY runs 1 April to 31 March, and the code is the last two digits of the year the
 * FY *started* in: 1 Apr 2026 – 31 Mar 2027 is "26". So the rollover lands on 31 March —
 * orders dated 31 Mar 2027 are still ORD26xxxx, and 1 Apr 2027 begins ORD27xxxx.
 *
 * Exported because the admin settings screen must derive the same code the minter does;
 * two copies of this rule previously disagreed with each other during April and May.
 */
export function deriveYY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed: 0 = Jan, 3 = Apr

  // Jan, Feb and Mar still belong to the FY that started the previous April.
  const fyStartYear = month < 3 ? year - 1 : year;

  return String(fyStartYear).slice(-2);
}

/**
 * Atomic, row-locked transaction to generate ORD{YY}{NNNN}
 */
export const generateOrderId = async (): Promise<string> => {
  return await prisma.$transaction(async (tx: any) => {
    const seq = await tx.$queryRaw<any[]>`SELECT * FROM "OrderSequence" WHERE id = 1 FOR UPDATE`;
    
    if (!seq || seq.length === 0) {
      throw new Error("OrderSequence not initialized. Please seed the database.");
    }
    
    let { last_number, year_code } = seq[0];
    const currentYY = deriveYY();
    
    if (year_code !== currentYY) {
      year_code = currentYY;
      last_number = 12; // first 12 numbers are reserved
    }

    last_number += 1;
    
    await tx.orderSequence.update({
      where: { id: 1 },
      data: { year_code, last_number },
    });
    
    return `ORD${year_code}${String(last_number).padStart(4, "0")}`;
  });
}
