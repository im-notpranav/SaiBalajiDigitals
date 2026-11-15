import { describe, expect, it } from "vitest";
import { groupZoneBoard, mondayOf, zoneRange, type ZoneJob } from "../../src/utils/zone-board";
import { isGoogleSheetUrl, sheetEmbedUrl } from "../../src/utils/google-sheet";

const SHEET = "https://docs.google.com/spreadsheets/d/11QfGW_viCceR_baPTm-wdy_CS1qGVJ63qkpDDFOEHV4";

describe("Sheet View link", () => {
  it("takes Google Sheets links, with or without /edit, ?usp and #gid", () => {
    expect(isGoogleSheetUrl(`${SHEET}/edit?usp=sharing`)).toBe(true);
    expect(isGoogleSheetUrl(SHEET)).toBe(true);
    expect(isGoogleSheetUrl(`${SHEET}/edit#gid=123`)).toBe(true);
  });

  it("refuses any other site, plain http, and look-alike hosts", () => {
    expect(isGoogleSheetUrl("http://docs.google.com/spreadsheets/d/11QfGW_viCceR_baPTm-wdy_CS1qGVJ63qkpDDFOEHV4")).toBe(false);
    expect(isGoogleSheetUrl("https://docs.google.com.evil.example/spreadsheets/d/11QfGW_viCceR_baPTm-wdy_CS1qG")).toBe(false);
    expect(isGoogleSheetUrl("https://evil.example/?u=https://docs.google.com/spreadsheets/d/11QfGW_viCceR_baPTm")).toBe(false);
    expect(isGoogleSheetUrl("https://docs.google.com/document/d/11QfGW_viCceR_baPTm-wdy_CS1qGVJ63qkpDDFOEHV4/edit")).toBe(false);
    expect(isGoogleSheetUrl(`${SHEET}/edit" onload="x`)).toBe(false);
    expect(isGoogleSheetUrl(42)).toBe(false);
  });

  it("opens the frame on the edit page without Google's menus, keeping the tab", () => {
    expect(sheetEmbedUrl(`${SHEET}/edit?usp=sharing`)).toBe(`${SHEET}/edit?rm=minimal`);
    expect(sheetEmbedUrl(`${SHEET}/edit#gid=987`)).toBe(`${SHEET}/edit?rm=minimal#gid=987`);
  });
});

describe("Zone Board weeks", () => {
  it("start on Monday, as on the Weekly Grid", () => {
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // a Sunday
    expect(mondayOf("2026-11-09")).toBe("2026-11-09"); // a Monday
    expect(zoneRange("2026-11-12", "week")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(zoneRange("2026-11-12", "day")).toEqual({ from: "2026-11-12", to: "2026-11-12" });
  });
});

describe("groupZoneBoard", () => {
  let next = 1;
  const job = (over: Partial<ZoneJob>): ZoneJob => ({
    id: next++,
    status: "ASSIGNED",
    start_date: "2026-11-15",
    end_date: "2026-11-15",
    locality: "LOCAL",
    work_details: null,
    area: null,
    order: null,
    csm: null,
    members: [],
    ...over,
  });
  const area = (id: number, name: string, district: string | null = null) => ({ id, name, district });
  const ravi = { user_id: 1, name: "Ravi", role: "PASTER" };
  const umar = { user_id: 2, name: "Umar", role: "DRIVER" };
  const abdul = { user_id: 3, name: "Abdul", role: "HELPER" };

  const board = groupZoneBoard([
    job({ area: area(1, "Madhapur"), members: [umar, ravi] }),
    job({ area: area(2, "ameerpet"), members: [ravi] }),
    job({ members: [abdul] }),
    job({ locality: "NON_LOCAL", area: area(3, "Hanamkonda", "Warangal"), members: [umar] }),
    job({ locality: "NON_LOCAL", area: area(4, "Kazipet", " warangal "), members: [abdul] }),
    job({ locality: "NON_LOCAL", area: area(5, "Karimnagar Town", "Karimnagar") }),
    job({ locality: "NON_LOCAL", area: area(6, "Somewhere", "") }),
    job({ locality: null, members: [ravi, abdul] }),
  ]);

  it("counts jobs and different people, someone on two jobs once", () => {
    expect(board.LOCAL.count).toEqual({ jobs: 3, people: 3 });
    expect(board.NON_LOCAL.count).toEqual({ jobs: 4, people: 2 });
    expect(board.NOT_SET.count).toEqual({ jobs: 1, people: 2 });
    expect(board.total).toEqual({ jobs: 8, people: 3 });
  });

  it("lists areas alphabetically, ignoring case, with no area last", () => {
    expect(board.LOCAL.areas.map((a) => a.name)).toEqual(["ameerpet", "Madhapur", null]);
  });

  it("groups non-local work by district, alphabetically, blank district last", () => {
    expect(board.NON_LOCAL.districts.map((d) => d.name)).toEqual(["Karimnagar", "Warangal", null]);
    const warangal = board.NON_LOCAL.districts[1];
    expect(warangal.areas.map((a) => a.name)).toEqual(["Hanamkonda", "Kazipet"]);
    expect(warangal.count).toEqual({ jobs: 2, people: 2 });
  });

  it("lists a team Paster, Helper, Driver", () => {
    const madhapur = board.LOCAL.areas.find((a) => a.name === "Madhapur")!;
    expect(madhapur.jobs[0].members.map((m) => m.name)).toEqual(["Ravi", "Umar"]);
  });
});
