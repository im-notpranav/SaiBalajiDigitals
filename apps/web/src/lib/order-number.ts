/**
 * The order-number rule, as the API checks it (validateCustomOrderNo in
 * apps/api/src/utils/order-sequence.ts): ORD, this financial year's code, then four digits from
 * 0001 to 9999 — e.g. ORD260001. Same messages, so the box and the server never disagree in
 * words. Change both together.
 */

/** 0001–0012 of each year are kept for typing by hand; the series itself starts at 0013. */
export const RESERVED_NUMBERS = 12;

export type OrderNoCheck = { ok: true; order_no: string; number: number } | { ok: false; error: string };

/**
 * This financial year's code in India time: 1 Apr 2026 – 31 Mar 2027 is "26". Only a fallback —
 * screens pass the code the server reports, so a wrong computer clock can't move the year.
 */
export function currentYearCode(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const year = ist.getUTCFullYear();
  return String(ist.getUTCMonth() < 3 ? year - 1 : year).slice(-2);
}

/** The year code inside a number like ORD260123, or undefined. */
export const yearCodeOf = (orderNo?: string | null) => (orderNo && /^ORD\d{6}$/.test(orderNo) ? orderNo.slice(3, 5) : undefined);

export function checkOrderNo(raw: string, yy: string = currentYearCode()): OrderNoCheck {
  const order_no = raw.trim().toUpperCase();
  const match = /^ORD(\d{2})(\d{4})$/.exec(order_no);
  if (!match) return { ok: false, error: `An order number is ORD, the year code and 4 digits, like ORD${yy}0123.` };
  if (match[1] !== yy) return { ok: false, error: `This financial year's numbers start ORD${yy}, like ORD${yy}0123.` };
  const number = parseInt(match[2]!, 10);
  if (number < 1) return { ok: false, error: "The last 4 digits run from 0001 to 9999." };
  return { ok: true, order_no, number };
}
