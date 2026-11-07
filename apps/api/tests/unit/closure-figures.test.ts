import { describe, expect, it } from "vitest";
import { closedAt, closureFigures } from "../../src/utils/order-stage";

// 2 November 2026 is a Monday, and the 8th is the Sunday after it.
const day = (d: number) => new Date(2026, 10, d, 12);
const invoice = (paidOn: Date | null) => ({
  invoice_no: "INV",
  bill_amount: 1000,
  amount_received: paidOn ? 1000 : null,
  payment_received_at: paidOn,
});
const order = (over: Partial<Parameters<typeof closedAt>[0]>) => ({
  status: "PaymentReceived",
  created_at: day(2),
  updated_at: day(20),
  invoices: [],
  ...over,
});

describe("closedAt", () => {
  it("uses the last payment for a fully paid order, not a later change to the row", () => {
    const paid = order({ invoices: [invoice(day(4)), invoice(day(6))] });
    expect(closedAt(paid)).toEqual(day(6));
  });

  it("uses the closure itself when an admin closed the order after a part payment", () => {
    const closedByAdmin = order({ status: "Completed", updated_at: day(12), invoices: [invoice(day(4))] });
    expect(closedAt(closedByAdmin)).toEqual(day(12));
  });

  it("falls back to the last change when a paid order has no payment date", () => {
    expect(closedAt(order({ invoices: [invoice(null)] }))).toEqual(day(20));
  });
});

describe("closureFigures", () => {
  it("has nothing to report when there are no orders", () => {
    expect(closureFigures(0, [])).toEqual({ closure_rate: null, avg_cycle_days: null });
  });

  it("reports a real zero rate, but no cycle time, when nothing has closed", () => {
    expect(closureFigures(5, [])).toEqual({ closure_rate: 0, avg_cycle_days: null });
  });

  it("rounds the rate to a whole percentage", () => {
    const closed = [order({ invoices: [invoice(day(2))] })];
    expect(closureFigures(3, closed).closure_rate).toBe(33);
  });

  it("averages working days, leaving out Sundays", () => {
    const closed = [
      order({ invoices: [invoice(day(2))] }), // same day: 0
      order({ invoices: [invoice(day(5))] }), // Monday to Thursday: 3
      order({ invoices: [invoice(day(9))] }), // Monday to the next Monday, over a Sunday: 6
      order({ status: "Completed", updated_at: day(3) }), // Monday to Tuesday: 1
    ];
    expect(closureFigures(4, closed)).toEqual({ closure_rate: 100, avg_cycle_days: 2.5 });
  });
});
