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
export function deriveYY(now: Date = new Date()): string {
  // In India time whatever the server's zone: on a UTC host, 1 April 00:00–05:30 IST would
  // otherwise still read as March (GAP-D05).
  const ist = new Date(now.getTime() + 330 * 60_000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth(); // 0-indexed: 0 = Jan, 3 = Apr

  // Jan, Feb and Mar still belong to the FY that started the previous April.
  const fyStartYear = month < 3 ? year - 1 : year;

  return String(fyStartYear).slice(-2);
}

/**
 * How many numbers are held back at the start of each financial year. The sequence
 * begins issuing at RESERVED_NUMBERS + 1, leaving 1-12 free to be assigned by hand.
 *
 * Exported so the admin settings screen enforces the same floor the minter starts from.
 */
export const RESERVED_NUMBERS = 12;

const formatOrderNo = (yearCode: string, n: number) => `ORD${yearCode}${String(n).padStart(4, "0")}`;

/**
 * The first number after `last` that no order has. An admin may type a number ahead of the
 * sequence, so the next one in line can already be taken.
 */
export async function firstFreeNumber(db: { order: { findUnique: (args: any) => Promise<unknown> } }, yearCode: string, last: number) {
  let n = last + 1;
  while (await db.order.findUnique({ where: { order_no: formatOrderNo(yearCode, n) }, select: { id: true } })) n += 1;
  return { number: n, order_no: formatOrderNo(yearCode, n) };
}

/** The next `count` numbers the sequence would give right now, without taking them. */
export async function previewOrderNumbers(count: number): Promise<string[]> {
  const seq = await prisma.orderSequence.findUnique({ where: { id: 1 } });
  if (!seq) return [];
  const currentYY = deriveYY();
  let last = seq.year_code === currentYY ? seq.last_number : RESERVED_NUMBERS;
  const numbers: string[] = [];
  for (let i = 0; i < count; i++) {
    const next = await firstFreeNumber(prisma, currentYY, last);
    numbers.push(next.order_no);
    last = next.number;
  }
  return numbers;
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
      last_number = RESERVED_NUMBERS;
    }

    const next = await firstFreeNumber(tx, year_code, last_number);

    await tx.orderSequence.update({
      where: { id: 1 },
      data: { year_code, last_number: next.number },
    });

    return next.order_no;
  });
}
