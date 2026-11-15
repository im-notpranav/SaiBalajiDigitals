import { describe, expect, it } from "vitest";
import {
  MAX_ORDER_NUMBER,
  OrderNumbersUsedUpError,
  firstFreeNumber,
  validateCustomOrderNo,
} from "../../src/utils/order-sequence";

/** 15 Nov 2026, inside FY 2026-27, so the year code is 26. */
const fy26 = new Date("2026-11-15T06:00:00Z");

describe("the order-number rule: ORD + this FY's code + 0001–9999", () => {
  it("accepts a good number and gives back its four-digit part", () => {
    expect(validateCustomOrderNo("ORD260001", fy26)).toEqual({ ok: true, order_no: "ORD260001", number: 1 });
    expect(validateCustomOrderNo("ORD260123", fy26)).toEqual({ ok: true, order_no: "ORD260123", number: 123 });
  });

  it("accepts 9999, the last number of the year", () => {
    expect(validateCustomOrderNo("ORD269999", fy26)).toEqual({ ok: true, order_no: "ORD269999", number: MAX_ORDER_NUMBER });
  });

  it("refuses 0000", () => {
    const r = validateCustomOrderNo("ORD260000", fy26);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("The last 4 digits run from 0001 to 9999.");
  });

  it("refuses another financial year's code", () => {
    for (const other of ["ORD250123", "ORD270123"]) {
      const r = validateCustomOrderNo(other, fy26);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("This financial year's numbers start ORD26, like ORD260123.");
    }
  });

  it("refuses five digits, three digits and anything that isn't ORD and digits", () => {
    for (const bad of ["ORD2600001", "ORD26001", "ORD26", "ORD", "ABC260001", "ORD26 0001", "ORD26000A", "ORD12345678901"]) {
      const r = validateCustomOrderNo(bad, fy26);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toBe("An order number is ORD, the year code and 4 digits, like ORD260123.");
    }
  });

  it("normalises lower case and stray spaces", () => {
    expect(validateCustomOrderNo("  ord260123 ", fy26)).toEqual({ ok: true, order_no: "ORD260123", number: 123 });
  });

  it("allows the hand-typed reserved numbers 0001–0012", () => {
    expect(validateCustomOrderNo("ORD260012", fy26).ok).toBe(true);
  });

  it("moves to the new code at midnight 1 April IST", () => {
    const fy27 = new Date("2027-03-31T18:31:00Z"); // 1 Apr 2027 00:01 IST
    expect(validateCustomOrderNo("ORD260123", fy27).ok).toBe(false);
    expect(validateCustomOrderNo("ORD270123", fy27).ok).toBe(true);
  });
});

describe("the minter never goes past ORD{YY}9999", () => {
  /** A stand-in for prisma.order with these numbers already used. */
  const dbWith = (taken: string[]) => ({
    order: {
      findMany: async (args: any) =>
        taken.filter((n) => n > args.where.order_no.gt && n <= args.where.order_no.lte).map((order_no) => ({ order_no })),
    },
  });

  it("gives the next free number, skipping ones already typed", async () => {
    await expect(firstFreeNumber(dbWith(["ORD260014"]), "26", 13)).resolves.toEqual({ number: 15, order_no: "ORD260015" });
  });

  it("can still issue 9999 itself", async () => {
    await expect(firstFreeNumber(dbWith([]), "26", 9998)).resolves.toEqual({ number: 9999, order_no: "ORD269999" });
  });

  it("refuses with a clear message once 9999 is used up", async () => {
    await expect(firstFreeNumber(dbWith([]), "26", 9999)).rejects.toBeInstanceOf(OrderNumbersUsedUpError);
    await expect(firstFreeNumber(dbWith(["ORD269998", "ORD269999"]), "26", 9997)).rejects.toThrow(
      "Order numbers for this financial year are used up (ORD269999). Contact the super admin.",
    );
  });
});
