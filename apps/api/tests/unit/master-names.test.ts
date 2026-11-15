import { describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import {
  groupMissingNames,
  lookupOf,
  missingFrom,
  missingNamesMessage,
  namesOfOrder,
  spellOrder,
  spellerOf,
} from "../../src/utils/lookups";
import { ORDER_TEMPLATE_HEADER, parseOrderTemplate } from "../../src/utils/order-template";

const masters = lookupOf({
  CLIENT: ["Vivo Mobiles", "Acme Traders"],
  LOCATION: ["Kukatpally", "Bajaj"],
  MEDIA: ["Vinyl", "Flex"],
});

function sheetOf(rows: unknown[][]): Buffer {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([ORDER_TEMPLATE_HEADER, ...rows]), "Orders");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}
const row = (client: string, location: string, store: string, media: string) =>
  [1, "01/04/2026", client, location, store, "", media, 12, 12, 1, "", 10, ""];

describe("Master Library names", () => {
  it("matches case and outer spaces aside, and spells names as the master does", () => {
    expect(missingFrom(masters, [{ kind: "CLIENT", name: "  vivo MOBILES " }])).toEqual([]);
    expect(spellerOf(masters)("CLIENT", " vivo mobiles")).toBe("Vivo Mobiles");
    expect(spellerOf(masters)("MEDIA", "Unknown ")).toBe("Unknown");
  });

  it("lists each missing name once, of its own kind", () => {
    const missing = missingFrom(masters, [
      { kind: "CLIENT", name: "Eric Traders" },
      { kind: "CLIENT", name: "eric traders" },
      { kind: "MEDIA", name: "Kukatpally" },
      { kind: "LOCATION", name: "" },
    ]);
    expect(missing).toEqual([
      { kind: "CLIENT", name: "Eric Traders" },
      { kind: "MEDIA", name: "Kukatpally" },
    ]);
  });

  it("says plainly what to ask the admin for", () => {
    expect(missingNamesMessage([{ kind: "CLIENT", name: "Eric Traders" }])).toBe(
      "Client 'Eric Traders' is not in Master Library. Ask the admin to add it.",
    );
    expect(missingNamesMessage([{ kind: "CLIENT", name: "A" }, { kind: "MEDIA", name: "B" }])).toBe(
      "These are not in Master Library: Client 'A', Media 'B'. Ask the admin to add them.",
    );
  });

  it("rewrites a whole order in the masters' spelling", () => {
    const order = { client_name: "acme traders", stores: [{ location: "BAJAJ", items: [{ media: "flex" }, { media: "Vinyl" }] }] };
    expect(namesOfOrder(order).map((n) => n.kind)).toEqual(["CLIENT", "LOCATION", "MEDIA", "MEDIA"]);
    spellOrder(order, spellerOf(masters));
    expect(order).toEqual({ client_name: "Acme Traders", stores: [{ location: "Bajaj", items: [{ media: "Flex" }, { media: "Vinyl" }] }] });
  });

  it("groups rejected rows by the name they need, A to Z within each kind", () => {
    const groups = groupMissingNames([
      { row: 4, missing: [{ kind: "MEDIA", name: "Sunboard" }] },
      { row: 2, missing: [{ kind: "CLIENT", name: "Zed Co" }, { kind: "MEDIA", name: "sunboard" }] },
      { row: 3, missing: [{ kind: "CLIENT", name: "Eric Traders" }] },
    ]);
    expect(groups).toEqual([
      { kind: "CLIENT", name: "Eric Traders", rows: [3] },
      { kind: "CLIENT", name: "Zed Co", rows: [2] },
      { kind: "MEDIA", name: "Sunboard", rows: [2, 4] },
    ]);
  });
});

describe("reading the order sheet against the Master Library (Q24)", () => {
  it("leaves out only the rows with unknown names, and imports the rest in the masters' spelling", () => {
    const { orders, errors, rejected } = parseOrderTemplate(
      sheetOf([
        row("vivo mobiles", "kukatpally", "KPHB", "vinyl"),
        row("Eric Traders", "Bajaj", "Malakpet", "Vinyl"),
        row("Vivo Mobiles", "Ameerpet", "Ameerpet", "Sunboard"),
        row("Vivo Mobiles", "Kukatpally", "KPHB", "Flex"),
      ]),
      masters,
    );
    expect(errors).toEqual([]);
    expect(rejected).toEqual([
      { row: 3, missing: [{ kind: "CLIENT", name: "Eric Traders" }] },
      { row: 4, missing: [{ kind: "LOCATION", name: "Ameerpet" }, { kind: "MEDIA", name: "Sunboard" }] },
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.client_name).toBe("Vivo Mobiles");
    expect(orders[0]!.stores).toHaveLength(1);
    expect(orders[0]!.stores[0]).toMatchObject({ store_name: "KPHB", location: "Kukatpally" });
    expect(orders[0]!.stores[0]!.items.map((i) => i.media)).toEqual(["Vinyl", "Flex"]);
  });

  it("reports a row's problems before its names, so a rejected row is otherwise sound", () => {
    const bad = [...row("Eric Traders", "Bajaj", "Malakpet", "Vinyl")];
    bad[7] = 0; // width
    const { errors, rejected } = parseOrderTemplate(sheetOf([bad]), masters);
    expect(errors.map((e) => e.row)).toEqual([2]);
    expect(rejected).toEqual([]);
  });

  it("checks no names when no lists are given", () => {
    const { orders, rejected } = parseOrderTemplate(sheetOf([row("Eric Traders", "Ameerpet", "X", "Sunboard")]));
    expect(rejected).toEqual([]);
    expect(orders[0]!.client_name).toBe("Eric Traders");
  });
});
