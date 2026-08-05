import { prisma } from "./prisma";

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

function deriveYY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed (0 = Jan, 5 = Jun)

  // FY runs June 1 through May 31 (FY ends May 31).
  // Months 0-4 (Jan-May) belong to the FY that started the previous June.
  let fyStartYear = year;
  if (month < 5) {
    fyStartYear = year - 1;
  }

  return String(fyStartYear).slice(-2);
}
