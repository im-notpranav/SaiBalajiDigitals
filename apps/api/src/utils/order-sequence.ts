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

/**
 * The last number a financial year can issue. Every order number is exactly nine characters,
 * ORD + two-digit year + four digits, so ORD{YY}9999 is the end of the year's series.
 */
export const MAX_ORDER_NUMBER = 9999;

const formatOrderNo = (yearCode: string, n: number) => `ORD${yearCode}${String(n).padStart(4, "0")}`;

/**
 * The series has run past ORD{YY}9999. Raised rather than handing out a ten-character number
 * nobody else's system expects; a controller sends `message` back as it is (409).
 */
export class OrderNumbersUsedUpError extends Error {
  readonly status = 409;
  constructor(yearCode: string) {
    super(`Order numbers for this financial year are used up (${formatOrderNo(yearCode, MAX_ORDER_NUMBER)}). Contact the super admin.`);
    this.name = "OrderNumbersUsedUpError";
  }
}

export const isOrderNumbersUsedUp = (err: unknown): err is OrderNumbersUsedUpError => err instanceof OrderNumbersUsedUpError;

export type OrderNoCheck = { ok: true; order_no: string; number: number } | { ok: false; error: string };

/**
 * The one rule for an order number someone types (the Allot Order dialog, the Settings series):
 * ORD, this financial year's code, then four digits from 0001 to 9999 — e.g. ORD260001.
 * Only the current year, so a number can't be parked in a year the series hasn't reached.
 * 0001–0012 are allowed here; they are the ones kept back for typing by hand.
 *
 * Returns the number trimmed and in capitals. The web mirrors this in lib/order-number.ts
 * with the same messages; change both together.
 */
export function validateCustomOrderNo(raw: string, now: Date = new Date()): OrderNoCheck {
  const order_no = raw.trim().toUpperCase();
  const yy = deriveYY(now);
  const match = /^ORD(\d{2})(\d{4})$/.exec(order_no);
  if (!match) {
    return { ok: false, error: `An order number is ORD, the year code and 4 digits, like ORD${yy}0123.` };
  }
  if (match[1] !== yy) {
    return { ok: false, error: `This financial year's numbers start ORD${yy}, like ORD${yy}0123.` };
  }
  const number = parseInt(match[2]!, 10);
  if (number < 1) {
    return { ok: false, error: "The last 4 digits run from 0001 to 9999." };
  }
  return { ok: true, order_no, number };
}

/**
 * The first number after `last` that no order has. An admin may type a number ahead of the
 * sequence, so the next one in line can already be taken. Throws OrderNumbersUsedUpError once
 * nothing up to ORD{YY}9999 is free.
 */
export async function firstFreeNumber(
  db: { order: { findMany: (args: any) => Promise<{ order_no: string }[]> } },
  yearCode: string,
  last: number,
) {
  // One query for every number already taken above `last` this year, then a scan in memory.
  // Numbers are fixed-width (ORD + 2 + 4 digits), so comparing the strings orders them.
  // The minter calls this under the sequence row lock, so it must stay a single round trip.
  const taken = await db.order.findMany({
    where: { order_no: { gt: formatOrderNo(yearCode, last), lte: formatOrderNo(yearCode, MAX_ORDER_NUMBER) } },
    select: { order_no: true },
  });
  const used = new Set(taken.map((o) => o.order_no));
  let n = last + 1;
  while (n <= MAX_ORDER_NUMBER && used.has(formatOrderNo(yearCode, n))) n += 1;
  if (n > MAX_ORDER_NUMBER) throw new OrderNumbersUsedUpError(yearCode);
  return { number: n, order_no: formatOrderNo(yearCode, n) };
}

/**
 * The next `count` numbers the sequence would give right now, without taking them. Stops short
 * when the year's numbers run out, so the upload review shows no number for the rest.
 */
export async function previewOrderNumbers(count: number): Promise<string[]> {
  const seq = await prisma.orderSequence.findUnique({ where: { id: 1 } });
  if (!seq) return [];
  const currentYY = deriveYY();
  let last = seq.year_code === currentYY ? seq.last_number : RESERVED_NUMBERS;
  const numbers: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const next = await firstFreeNumber(prisma, currentYY, last);
      numbers.push(next.order_no);
      last = next.number;
    } catch (err) {
      if (isOrderNumbersUsedUp(err)) break;
      throw err;
    }
  }
  return numbers;
}

/**
 * Atomic, row-locked transaction to generate ORD{YY}{NNNN}. Throws OrderNumbersUsedUpError
 * (and moves nothing) once the year has no number left up to ORD{YY}9999.
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
