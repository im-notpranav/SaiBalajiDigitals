import { describe, expect, it } from "vitest";
import {
  cleanName,
  editDistance,
  findDuplicateGroups,
  groupSignature,
  looksSame,
  nameKey,
  parseActive,
  parseLocality,
} from "../../src/utils/master-names";
import {
  buildMasterWorkbook,
  parseMasterSheet,
  parseMasterWorkbook,
  planSheet,
  type ExistingEntry,
} from "../../src/utils/master-workbook";

const names = (groups: { name: string }[][]) => groups.map((g) => g.map((m) => m.name));
const items = (...list: string[]) => list.map((name, i) => ({ id: i + 1, name }));

describe("cleanName and nameKey", () => {
  it("trims and collapses spaces", () => {
    expect(cleanName("  Big   C ")).toBe("Big C");
    expect(cleanName("Big\tC\n")).toBe("Big C");
  });

  it("ignores case, spaces and punctuation", () => {
    expect(nameKey("Big C")).toBe("bigc");
    expect(nameKey("BigC")).toBe("bigc");
    expect(nameKey("BIG-C")).toBe("bigc");
    expect(nameKey("big.c.")).toBe("bigc");
  });

  it("reads & as and", () => {
    expect(nameKey("Tom & Jerry")).toBe(nameKey("Tom and Jerry"));
  });

  it("keeps letters of other scripts and never returns an empty key", () => {
    expect(nameKey("హైదరాబాద్")).not.toBe("");
    expect(nameKey("---")).toBe("---");
  });
});

describe("editDistance", () => {
  it("counts slips and stops early past the limit", () => {
    expect(editDistance("ameerpet", "ameerpeth", 1)).toBe(1);
    expect(editDistance("kukatpally", "kukatpaly", 2)).toBe(1);
    expect(editDistance("abcdef", "uvwxyz", 1)).toBe(2);
    expect(editDistance("same", "same", 0)).toBe(0);
    // Two letters swapped is one slip.
    expect(editDistance("reliance", "relaince", 2)).toBe(1);
  });
});

describe("findDuplicateGroups", () => {
  it("groups spellings that differ only by case, spaces or punctuation", () => {
    const groups = findDuplicateGroups(items("Big C", "BigC", "BIG-C", "Reliance"));
    expect(names(groups)).toEqual([["Big C", "BIG-C", "BigC"]]);
  });

  it("catches a typing slip in a longer name", () => {
    expect(names(findDuplicateGroups(items("Ameerpet", "Ameerpeth", "Begumpet")))).toEqual([["Ameerpet", "Ameerpeth"]]);
    expect(names(findDuplicateGroups(items("Reliance Trends", "Relaince Trend")))).toEqual([["Relaince Trend", "Reliance Trends"]]);
  });

  it("leaves short names alone", () => {
    expect(findDuplicateGroups(items("Spar", "Star", "Stars"))).toEqual([]);
  });

  it("does not join branches or codes that differ by a short word", () => {
    const groups = findDuplicateGroups(
      items("Reliance Retail Limited - AP", "Reliance Retail Limited - TS", "Greenlam Industries Limited", "Greenlam Industries Limited - AP", "Store A", "Store B"),
    );
    expect(groups).toEqual([]);
    expect(looksSame("Reliance Retail Limited - AP", "Reliance Retail Limited - AP.")).toBe(true);
  });

  it("does not join names whose numbers differ", () => {
    expect(findDuplicateGroups(items("Kukatpally Phase 1", "Kukatpally Phase 2"))).toEqual([]);
    expect(findDuplicateGroups(items("Sunboard 3mm", "Sunboard 5mm"))).toEqual([]);
  });

  it("chains slips into one group and sorts groups by name", () => {
    const groups = findDuplicateGroups(items("Zeta Signs", "Malkajgiri", "Malkajgir", "Zeta-Signs", "malkajgiri"));
    expect(names(groups)).toEqual([
      ["malkajgiri", "Malkajgiri", "Malkajgir"].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b)),
      ["Zeta Signs", "Zeta-Signs"],
    ]);
  });

  it("hides a group the admin marked as different names", () => {
    const list = items("Store Alpha", "Store Alpah");
    const sig = groupSignature(list.map((i) => i.name));
    expect(findDuplicateGroups(list)).toHaveLength(1);
    expect(findDuplicateGroups(list, new Set([sig]))).toEqual([]);
  });

  it("agrees with looksSame", () => {
    expect(looksSame("Big C", "BIG-C")).toBe(true);
    expect(looksSame("Ameerpet", "Ameerpeth")).toBe(true);
    expect(looksSame("Spar", "Star")).toBe(false);
  });
});

describe("sheet cell values", () => {
  it("reads Hyderabad / Non-local", () => {
    expect(parseLocality("Hyderabad")).toBe("LOCAL");
    expect(parseLocality(" local ")).toBe("LOCAL");
    expect(parseLocality("Non-local")).toBe("NON_LOCAL");
    expect(parseLocality("NON LOCAL")).toBe("NON_LOCAL");
    expect(parseLocality("")).toBeUndefined();
    expect(parseLocality("Mumbai")).toBeNull();
  });

  it("reads Yes / No", () => {
    expect(parseActive("Yes")).toBe(true);
    expect(parseActive("no")).toBe(false);
    expect(parseActive("Archived")).toBe(false);
    expect(parseActive("")).toBeUndefined();
    expect(parseActive("maybe")).toBeNull();
  });
});

describe("parseMasterSheet", () => {
  it("reads rows under the headings with Excel row numbers", () => {
    const sheet = parseMasterSheet("CLIENT", [
      ["Client list"],
      ["Name", "Code", "Active"],
      ["Big C", "bigc", "Yes"],
      ["", "", ""],
      ["  Reliance   Trends ", "", ""],
      ["Example: Someone", "EX", "Yes"],
    ]);
    expect(sheet.problem).toBeUndefined();
    expect(sheet.errors).toEqual([]);
    expect(sheet.rows).toEqual([
      { row: 3, name: "Big C", code: "BIGC", active: true },
      { row: 5, name: "Reliance Trends" },
    ]);
  });

  it("says when there is no Name column", () => {
    expect(parseMasterSheet("MEDIA", [["Media type"], ["Flex"]]).problem).toMatch(/no Name column/);
  });

  it("flags bad cells and repeated names by row", () => {
    const sheet = parseMasterSheet("CLIENT", [
      ["Name", "Code"],
      ["Big C", "BIG C!"],
      ["", "X1"],
      ["Spar", "SP"],
      ["SPAR", ""],
      ["Spar-Hyper", "SP"],
      ["S.P.A.R", ""],
    ]);
    expect(sheet.errors).toEqual([
      { row: 2, message: expect.stringMatching(/Code can only have/) },
      { row: 3, message: "Missing Name." },
      { row: 5, message: "Same name as row 4." },
      { row: 6, message: "Code SP is also on row 4." },
      { row: 7, message: 'Looks the same as "Spar" on row 4.' },
    ]);
    expect(sheet.rows.map((r) => r.name)).toEqual(["Spar"]);
  });

  it("reads locality and district on Locations", () => {
    const sheet = parseMasterSheet("LOCATION", [
      ["Name", "Hyderabad / Non-local", "District", "Active"],
      ["Ameerpet", "Hyderabad", "Hyderabad", ""],
      ["Warangal", "Non-local", "Warangal", "No"],
      ["Somewhere", "Moon", "", ""],
      ["Kompally", "", "", ""],
    ]);
    expect(sheet.rows).toEqual([
      { row: 2, name: "Ameerpet", locality: "LOCAL", district: "Hyderabad" },
      { row: 3, name: "Warangal", locality: "NON_LOCAL", district: "Warangal", active: false },
      { row: 5, name: "Kompally" },
    ]);
    expect(sheet.errors).toEqual([{ row: 4, message: "Write Hyderabad or Non-local." }]);
  });
});

describe("planSheet", () => {
  const clients: ExistingEntry[] = [
    { id: 1, name: "Big C", code: null, is_active: true },
    { id: 2, name: "Spar", code: "SP", is_active: true },
    { id: 3, name: "Old Shop", code: null, is_active: false },
  ];

  it("adds new names, updates known ones ignoring case, counts the rest unchanged", () => {
    const sheet = parseMasterSheet("CLIENT", [
      ["Name", "Code", "Active"],
      ["big c", "BIGC", ""],
      ["Spar", "SP", "Yes"],
      ["OLD SHOP", "", "Yes"],
      ["New Mart", "NM", ""],
    ]);
    const plan = planSheet("CLIENT", sheet, clients);
    expect(plan.errors).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.adds).toEqual([{ row: 5, name: "New Mart", data: { name: "New Mart", code: "NM", is_active: true }, detail: "Code NM" }]);
    expect(plan.updates.map((u) => [u.id, u.data, u.detail])).toEqual([
      [1, { code: "BIGC" }, "Code — → BIGC"],
      [3, { is_active: true }, "Restored"],
    ]);
  });

  it("refuses a lookalike of a listed name and a code already taken", () => {
    const sheet = parseMasterSheet("CLIENT", [
      ["Name", "Code"],
      ["BigC", ""],
      ["Fresh", "SP"],
      ["Big C", "SP"],
    ]);
    const plan = planSheet("CLIENT", sheet, clients);
    expect(plan.adds).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(plan.errors[0]!.message).toMatch(/Looks the same as "Big C"/);
    expect(plan.errors[1]!.message).toBe('Code SP is already used by "Spar".');
  });

  it("marks a new location without a locality for review, and confirms one when it is given", () => {
    const areas: ExistingEntry[] = [{ id: 9, name: "Kompally", locality: "LOCAL", district: null, needs_confirmation: true, is_active: true }];
    const sheet = parseMasterSheet("LOCATION", [
      ["Name", "Hyderabad / Non-local", "District"],
      ["Kompally", "Hyderabad", ""],
      ["Nizamabad", "", "Nizamabad"],
    ]);
    const plan = planSheet("LOCATION", sheet, areas);
    expect(plan.updates).toEqual([
      { row: 2, id: 9, name: "Kompally", data: { locality: "LOCAL", needs_confirmation: false }, detail: "Hyderabad (confirmed)" },
    ]);
    expect(plan.adds[0]!.data).toEqual({ name: "Nizamabad", is_active: true, locality: "LOCAL", district: "Nizamabad", needs_confirmation: true });
  });
});

describe("workbook round trip", () => {
  it("imports nothing from the untouched template", () => {
    const { sheets, fileError } = parseMasterWorkbook(buildMasterWorkbook());
    expect(fileError).toBeUndefined();
    for (const s of Object.values(sheets)) {
      expect(s.found).toBe(true);
      expect(s.rows).toEqual([]);
      expect(s.errors).toEqual([]);
    }
  });

  it("re-imports its own export with no changes, leaving review flags alone", () => {
    const data = {
      clients: [
        { name: "Big C", code: "BIGC", is_active: true },
        { name: "Old Shop", code: null, is_active: false },
      ],
      media: [{ name: "Star Flex", is_active: true }],
      locations: [
        { name: "Ameerpet", locality: "LOCAL" as const, district: "Hyderabad", needs_confirmation: false, is_active: true },
        { name: "Kompally", locality: "LOCAL" as const, district: null, needs_confirmation: true, is_active: true },
      ],
    };
    const { sheets } = parseMasterWorkbook(buildMasterWorkbook(data));
    const withIds = <T>(list: T[]) => list.map((e, i) => ({ id: i + 1, ...e }));
    expect(planSheet("CLIENT", sheets.CLIENT, withIds(data.clients))).toMatchObject({ adds: [], updates: [], unchanged: 2, errors: [] });
    expect(planSheet("MEDIA", sheets.MEDIA, withIds(data.media))).toMatchObject({ adds: [], updates: [], unchanged: 1, errors: [] });
    expect(planSheet("LOCATION", sheets.LOCATION, withIds(data.locations))).toMatchObject({ adds: [], updates: [], unchanged: 2, errors: [] });
  });

  it("says plainly when the file is not a workbook or has none of the sheets", () => {
    expect(parseMasterWorkbook(Buffer.from("not a spreadsheet")).fileError).toBeTruthy();
  });
});
