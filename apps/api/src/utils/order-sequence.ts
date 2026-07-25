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
      last_number = 0;
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
  const month = now.getMonth(); // 0-indexed (0 = Jan, 4 = May)
  
  // Using May 1 - April 30 as FY per original spec
  // If month is < 4 (Jan-Apr), we are in the FY that started the previous year
  let fyStartYear = year;
  if (month < 4) {
    fyStartYear = year - 1;
  }
  
  // Take last 2 digits of the FY start year. (E.g., FY starting May 2025 -> "25")
  // Or if it should be the "end" year, adjust accordingly.
  // Using start year digits, plus 1 to match "26" in ORD260001 (which means FY25-26 ending in 2026).
  const fyEndYear = fyStartYear + 1;
  return String(fyEndYear).slice(-2);
}
