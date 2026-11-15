import { describe, expect, it } from "vitest";
import {
  RangeError400,
  ageBucket,
  bucketLabels,
  fyStartOf,
  inRange,
  istMonth,
  monthsOf,
  overlapDays,
  parseRange,
  workingDaysIn,
} from "../../src/utils/report-range";

describe("parseRange", () => {
  // 15 Nov 2026, 20:00 UTC is 16 Nov 01:30 in India.
  const now = new Date("2026-11-15T20:00:00Z");

  it("defaults to the financial year so far, in India time", () => {
    const r = parseRange({}, now);
    expect(r.from).toBe("2026-04-01");
    expect(r.to).toBe("2026-11-16");
  });

  it("starts at India midnight and ends at the midnight after the last day", () => {
    const r = parseRange({ from: "2026-11-01", to: "2026-11-30" }, now);
    expect(r.start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(inRange("2026-11-30T18:29:59.999Z", r)).toBe(true);
    expect(inRange("2026-11-30T18:30:00.000Z", r)).toBe(false);
    expect(inRange("2026-10-31T18:29:59.999Z", r)).toBe(false);
  });

  it("refuses bad days, reversed ranges and ranges over three years", () => {
    expect(() => parseRange({ from: "2026-02-30" }, now)).toThrow(RangeError400);
    expect(() => parseRange({ from: "15/11/2026" }, now)).toThrow(RangeError400);
    expect(() => parseRange({ from: "2026-11-02", to: "2026-11-01" }, now)).toThrow(RangeError400);
    expect(() => parseRange({ from: "2020-01-01", to: "2026-11-01" }, now)).toThrow(RangeError400);
  });
});

describe("financial year and months", () => {
  it("puts January to March in the year that began the April before", () => {
    expect(fyStartOf("2027-03-31")).toBe("2026-04-01");
    expect(fyStartOf("2026-04-01")).toBe("2026-04-01");
  });

  it("lists every month the range touches, across a year end", () => {
    expect(monthsOf(parseRange({ from: "2026-11-20", to: "2027-02-03" }))).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("reads the month in India time", () => {
    expect(istMonth("2026-11-30T19:00:00Z")).toBe("2026-12");
  });
});

describe("day counting", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);

  it("counts shared days, both ends included", () => {
    expect(overlapDays(d("2026-11-01"), d("2026-11-10"), d("2026-11-08"), d("2026-11-20"))).toBe(3);
    expect(overlapDays(d("2026-11-01"), d("2026-11-02"), d("2026-11-05"), d("2026-11-06"))).toBe(0);
  });

  it("leaves Sundays out of working days", () => {
    // 1 Nov 2026 is a Sunday.
    expect(overlapDays(d("2026-11-01"), d("2026-11-07"), d("2026-11-01"), d("2026-11-07"), true)).toBe(6);
    expect(workingDaysIn(parseRange({ from: "2026-11-01", to: "2026-11-30" }))).toBe(25);
  });
});

describe("ageBucket", () => {
  it("files a day count under the first edge it does not pass", () => {
    expect(ageBucket(0, [30, 60, 90])).toBe("0–30");
    expect(ageBucket(30, [30, 60, 90])).toBe("0–30");
    expect(ageBucket(31, [30, 60, 90])).toBe("31–60");
    expect(ageBucket(91, [30, 60, 90])).toBe("90+");
  });

  it("names every bucket it can return", () => {
    expect(bucketLabels([2, 5, 10])).toEqual(["0–2", "3–5", "6–10", "10+"]);
  });
});
