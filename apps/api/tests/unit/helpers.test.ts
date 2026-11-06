import { describe, expect, it } from "vitest";
import { canRemoveFile } from "../../src/utils/payment-files";
import { deriveYY } from "../../src/utils/order-sequence";
import { gridLabel, overtimeSpan, teamLimitErrors, formatMinutes, STATUS_TRANSITIONS } from "../../src/utils/work-allocation";
import { deriveStatus } from "../../src/utils/order-derive";

describe("canRemoveFile (GAP-F04)", () => {
  const open = { status: "CCM_REVIEW" as const, requested_by: 10 };
  const mine = { uploaded_by: 10 };
  const requester = { id: 10, role: "CSM" };

  it("lets the requester remove their own file until the request is first approved", () => {
    expect(canRemoveFile(open, mine, requester)).toBe(true);
    expect(canRemoveFile(open, mine, requester, { approvedOnce: true })).toBe(false);
  });

  it("never lets anyone remove someone else's file unless they review", () => {
    expect(canRemoveFile(open, { uploaded_by: 99 }, requester)).toBe(false);
    expect(canRemoveFile(open, { uploaded_by: 99 }, { id: 1, role: "ADMIN" }, { approvedOnce: true })).toBe(true);
  });

  it("freezes files on finished requests", () => {
    for (const status of ["CLOSED", "REJECTED", "CANCELLED"] as const) {
      expect(canRemoveFile({ status, requested_by: 10 }, mine, { id: 2, role: "COST_CONTROL_MANAGER" })).toBe(false);
    }
  });
});

describe("deriveYY in India time (GAP-D05)", () => {
  it("rolls over at midnight 1 April IST, not UTC", () => {
    // 31 Mar 2027 18:31 UTC is 1 Apr 2027 00:01 IST.
    expect(deriveYY(new Date("2027-03-31T18:31:00Z"))).toBe("27");
    // 31 Mar 2027 18:29 UTC is still 31 Mar 23:59 IST.
    expect(deriveYY(new Date("2027-03-31T18:29:00Z"))).toBe("26");
  });

  it("keeps Jan–Mar in the FY that began the April before", () => {
    expect(deriveYY(new Date("2027-01-15T06:00:00Z"))).toBe("26");
    expect(deriveYY(new Date("2026-12-31T20:00:00Z"))).toBe("26"); // 1 Jan 2027 IST
  });
});

describe("work allocation helpers", () => {
  it("caps each role in a team", () => {
    expect(teamLimitErrors(["PASTER", "PASTER", "HELPER", "DRIVER"])).toEqual([]);
    expect(teamLimitErrors(["DRIVER", "DRIVER"])).toEqual(["A job can have at most 1 driver (got 2)."]);
    expect(teamLimitErrors(["PASTER", "PASTER", "PASTER"])[0]).toMatch(/at most 2 pasters \(got 3\)/);
  });

  it("labels grid cells like the old sheet", () => {
    expect(gridLabel({ csmCode: { code: "600" }, locality: "LOCAL" })).toBe("600");
    expect(gridLabel({ csmCode: { code: "088" }, csm2Code: { code: "NSG" }, locality: "LOCAL" })).toBe("088/NSG");
    expect(gridLabel({ csmCode: { code: "600" }, locality: "NON_LOCAL", extra_tag: "CN" })).toBe("600-N_CN");
    expect(gridLabel({ order: { order_no: "ORD260040" }, locality: "LOCAL", extra_tag: "X" })).toBe("ORD260040-X");
  });

  it("measures overtime, across midnight too", () => {
    expect(overtimeSpan("2026-10-01", "18:00", "21:30")).toMatchObject({ minutes: 210, past_midnight: false });
    expect(overtimeSpan("2026-10-01", "22:00", "02:00")).toMatchObject({ minutes: 240, past_midnight: true });
    expect(formatMinutes(390)).toBe("6h 30m");
    expect(formatMinutes(120)).toBe("2h");
  });

  it("never revives a cancelled job", () => {
    expect(STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    expect(STATUS_TRANSITIONS.COMPLETED).toEqual(["STARTED"]);
  });
});

describe("deriveStatus", () => {
  const store = (installed: boolean, invoice: number | null = null) => ({ installed_at: installed ? new Date() : null, invoice_id: invoice });

  it("follows installation before billing", () => {
    expect(deriveStatus({ status: "Active", items: [], stores: [], invoices: [] })).toBe("Active");
    expect(deriveStatus({ status: "Active", items: [], stores: [store(true), store(false)], invoices: [] })).toBe("Active");
    expect(deriveStatus({ status: "Active", items: [], stores: [store(true), store(true)], invoices: [] })).toBe("Installed");
  });

  it("never moves a closed order", () => {
    expect(deriveStatus({ status: "Completed", items: [], stores: [store(false)], invoices: [] })).toBe("Completed");
  });
});
