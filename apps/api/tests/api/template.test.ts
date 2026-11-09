import { beforeAll, describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import { as, makeUser, prisma, uniq } from "./helpers";
import { ORDER_EXPORT_HEADER, ORDER_TEMPLATE_HEADER, buildOrderTemplate, parseOrderTemplate } from "../../src/utils/order-template";

/** A sheet shaped like the company's file, whose Amount heading is padded with spaces. */
function sheetOf(rows: unknown[][], header: string[] = [...ORDER_TEMPLATE_HEADER.slice(0, 12), " Amount "]): Buffer {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([header, ...rows]), "Sheet1");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
}

const SERIAL_1_APR_2026 = 46113;
const row = (date: unknown, client: string, location: string, store: string, media = "Vinly", w: unknown = 17, h: unknown = 105, q: unknown = 1, rate: unknown = 50) =>
  [1, date, client, location, store, "IGNORED", media, w, h, q, 999, rate, 999];

describe("reading the order sheet", () => {
  it("makes one order per client, and works out SFT and Amount itself", () => {
    const { orders, errors } = parseOrderTemplate(sheetOf([
      row(SERIAL_1_APR_2026, "Vivo Hyd 1", "Bajaj", "Malakpet"),
      row(SERIAL_1_APR_2026, "Vivo Hyd 1", "Bajaj", "Malakpet", "Flex", 48, 36, 2, 40),
      row(SERIAL_1_APR_2026 + 3, "Vivo Mobiles", "Kukatpally", "KPHB"),
    ]));
    expect(errors).toEqual([]);
    expect(orders.map((o) => [o.client_name, o.date])).toEqual([["Vivo Hyd 1", "2026-04-01"], ["Vivo Mobiles", "2026-04-04"]]);
    const first = orders[0]!;
    expect(first.stores).toHaveLength(1);
    expect(first.stores[0]).toMatchObject({ store_name: "Malakpet", location: "Bajaj" });
    expect(first.stores[0]!.items[0]).toMatchObject({ media: "Vinly", total_sft: 12.4, amount: 620 });
    expect(first.stores[0]!.items[1]).toMatchObject({ total_sft: 24, amount: 960 });
  });

  it("skips the sheet's prepared but unfilled rows", () => {
    const blank = ["", "", "", "", "", "", "", "", "", "", 0, "", 0];
    const { orders, errors } = parseOrderTemplate(sheetOf([row(SERIAL_1_APR_2026, "Acme", "Bajaj", "Malakpet"), blank, blank]));
    expect(errors).toEqual([]);
    expect(orders).toHaveLength(1);
  });

  it("names the sheet row of each problem", () => {
    const { errors } = parseOrderTemplate(sheetOf([
      row(SERIAL_1_APR_2026, "Acme", "Bajaj", "Malakpet"),
      row(SERIAL_1_APR_2026, "", "Bajaj", "Malakpet"),
      row("not a date", "Acme", "Bajaj", "Malakpet"),
      row(SERIAL_1_APR_2026, "Acme", "", "New Store"),
      row(SERIAL_1_APR_2026, "Acme", "Bajaj", "Malakpet", "Flex", 0),
      row(SERIAL_1_APR_2026, "Acme", "Bajaj", "Malakpet", "Flex", 10, 10, 1.5),
      row(90000, "Acme", "Bajaj", "Malakpet"),
    ]));
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(errors[0]!.message).toContain("Client Name");
    expect(errors[5]!.message).toContain("future");
  });

  it("flags a client whose rows carry different dates, keeping the first", () => {
    const { orders } = parseOrderTemplate(sheetOf([
      row(SERIAL_1_APR_2026, "Acme", "Bajaj", "Malakpet"),
      row(SERIAL_1_APR_2026 + 1, "acme", "Bajaj", "Malakpet"),
    ]));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ date: "2026-04-01", has_other_dates: true });
  });

  it("reads typed dates day first", () => {
    const { orders } = parseOrderTemplate(sheetOf([row("01/04/2026", "Acme", "Bajaj", "Malakpet")]));
    expect(orders[0]!.date).toBe("2026-04-01");
  });

  it("refuses a file that is not the template", () => {
    const { fileError } = parseOrderTemplate(sheetOf([["x"]], ["Something"]));
    expect(fileError).toContain("not the order template");
    expect(parseOrderTemplate(Buffer.from("not excel at all")).orders).toEqual([]);
  });

  it("reads back the template it hands out", () => {
    const wb = xlsx.read(buildOrderTemplate(), { type: "buffer" });
    expect(wb.SheetNames[0]).toBe("Orders");
    const sheet = wb.Sheets.Orders!;
    expect(xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0]).toEqual(ORDER_TEMPLATE_HEADER);
    expect(sheet.K2.f).toContain("H2*I2*J2/144");
    expect(parseOrderTemplate(buildOrderTemplate()).fileError).toContain("no order rows");
  });
});

describe("uploading orders", () => {
  const order = (client: string, csm_user_id?: number) => ({
    client_name: client,
    date: "2026-04-01",
    csm_user_id,
    stores: [{ store_name: "Malakpet", location: "Bajaj", items: [{ media: "Vinly", width_inches: 17, height_inches: 105, qty: 1, rate: 50 }] }],
  });
  let admin: any;
  let plainAdmin: any;
  let csm: any;

  beforeAll(async () => {
    admin = await makeUser("ADMIN", { is_super_admin: true });
    plainAdmin = await makeUser("ADMIN");
    csm = await makeUser("CSM");
    await prisma.orderSequence.upsert({ where: { id: 1 }, update: {}, create: { id: 1, year_code: "26", last_number: 12 } });
  });

  it("previews without saving", async () => {
    const before = await prisma.order.count();
    const client = uniq("Preview");
    const res = await as(csm)
      .post("/api/orders/bulk/preview")
      .set("Content-Type", "application/octet-stream")
      .send(sheetOf([row(SERIAL_1_APR_2026, client, "Bajaj", "Malakpet")]));
    expect(res.status).toBe(200);
    expect(res.body.orders[0].client_name).toBe(client);
    expect(res.body.orders[0].expected_order_no).toMatch(/^ORD\d+$/);
    expect(await prisma.order.count()).toBe(before);
  });

  it("a CSM's upload is their own, dated from the sheet, with figures worked out here", async () => {
    const client = uniq("Own");
    const res = await as(csm).post("/api/orders/bulk").send({ orders: [{ ...order(client), csm_user_id: admin.id }] });
    expect(res.status).toBe(201);
    const saved = await prisma.order.findUnique({ where: { order_no: res.body.orders[0].order_no }, include: { items: true, stores: true } });
    expect(saved).toMatchObject({ created_by: csm.id, client_name: client });
    expect(saved!.date.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(saved!.stores[0]).toMatchObject({ store_name: "Malakpet", location: "Bajaj" });
    expect(Number(saved!.items[0]!.total_sft)).toBe(12.4);
    expect(Number(saved!.items[0]!.amount)).toBe(620);
    expect(await prisma.media.findFirst({ where: { name: "Vinly" } })).toBeTruthy();
  });

  it("an admin must pick an active CSM for every order", async () => {
    const missing = await as(admin).post("/api/orders/bulk").send({ orders: [order(uniq("NoCsm"))] });
    expect(missing.status).toBe(400);
    const notCsm = await as(admin).post("/api/orders/bulk").send({ orders: [order(uniq("NotCsm"), admin.id)] });
    expect(notCsm.status).toBe(400);

    const client = uniq("ForCsm");
    const ok = await as(admin).post("/api/orders/bulk").send({ orders: [order(client, csm.id)] });
    expect(ok.status).toBe(201);
    const saved = await prisma.order.findUnique({ where: { order_no: ok.body.orders[0].order_no } });
    expect(saved).toMatchObject({ created_by: csm.id, creator_name: csm.name });
    const audit = await prisma.auditLog.findFirst({ where: { table_name: "Order", record_id: saved!.id, action: "INSERT" } });
    expect(audit?.changed_by).toBe(admin.id);
  });

  it("among admins, only the super admin may upload", async () => {
    const res = await as(plainAdmin).post("/api/orders/bulk").send({ orders: [order(uniq("Plain"), csm.id)] });
    expect(res.status).toBe(403);
  });

  it("exports the template's columns, then the line remark columns", async () => {
    const client = uniq("Export");
    await as(csm).post("/api/orders/bulk").send({ orders: [order(client)] });
    const res = await as(csm).get("/api/orders/export").buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const wb = xlsx.read(res.body, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
    // The template's columns come first and unchanged, so the file still re-imports.
    expect(Object.keys(rows[0]!)).toEqual(ORDER_EXPORT_HEADER);
    expect(ORDER_EXPORT_HEADER.slice(0, ORDER_TEMPLATE_HEADER.length)).toEqual(ORDER_TEMPLATE_HEADER);
    const mine = rows.find((r) => r["Client Name"] === client)!;
    expect(mine).toMatchObject({ "Store Name": "Malakpet", Location: "Bajaj", Media: "Vinly", "Total SFT": 12.4, Amount: 620, "Billed Amount": 620 });
    expect(mine.Date).toBe("1/4/2026");
  });

  it("the template is for CSMs and admins", async () => {
    const res = await as(csm).get("/api/orders/template");
    expect(res.status).toBe(200);
    const accountant = await makeUser("ACCOUNTS");
    expect((await as(accountant).get("/api/orders/template")).status).toBe(403);
  });
});
