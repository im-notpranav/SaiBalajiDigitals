import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, prisma, uniq } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let accounts: Awaited<ReturnType<typeof makeUser>>;
let ccm: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

const TABS = ["orders", "money", "csm", "production", "allocation", "payments", "masters", "system"];
const day = (offset = 0) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  om = await makeUser("OPERATION_MANAGER");
  accounts = await makeUser("ACCOUNTS");
  ccm = await makeUser("COST_CONTROL_MANAGER");
  csm = await makeUser("CSM");
});

describe("GET /api/reports/:tab", () => {
  it("answers every tab for the admin and the OM", async () => {
    for (const u of [admin, om]) {
      for (const tab of TABS) {
        const res = await as(u).get(`/api/reports/${tab}?from=2026-04-01&to=2026-11-30`);
        expect(res.status, `${u.role} ${tab}`).toBe(200);
        expect(res.body.range).toEqual({ from: "2026-04-01", to: "2026-11-30" });
        expect(res.body.kpis).toBeTruthy();
      }
    }
  });

  it("gives Accounts the Money tab only, and Cost Control the Payments tab only", async () => {
    expect((await as(accounts).get("/api/reports/money")).status).toBe(200);
    expect((await as(accounts).get("/api/reports/orders")).status).toBe(403);
    expect((await as(ccm).get("/api/reports/payments")).status).toBe(200);
    expect((await as(ccm).get("/api/reports/money")).status).toBe(403);
  });

  it("keeps every tab from a CSM", async () => {
    for (const tab of TABS) expect((await as(csm).get(`/api/reports/${tab}`)).status, tab).toBe(403);
  });

  it("answers 404 for an unknown tab and 400 for a bad range", async () => {
    expect((await as(admin).get("/api/reports/constructor")).status).toBe(404);
    const bad = await as(admin).get("/api/reports/orders?from=2026-12-01&to=2026-11-01");
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/after the end date/);
  });

  it("counts an order created in the range at its billable value, and filters by CSM", async () => {
    const owner = await makeUser("CSM");
    const { order } = await makeOrder(owner);
    const res = await as(admin).get(`/api/reports/orders?from=${day(-2)}&to=${day()}&csm=${owner.id}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.created).toBe(1);
    expect(res.body.kpis.created_value).toBe(1000);
    expect(res.body.kpis.open).toBe(1);
    expect(res.body.stuck.map((s: any) => s.order_id)).toContain(order.id);

    const csmTab = await as(admin).get(`/api/reports/csm?from=${day(-2)}&to=${day()}`);
    const row = csmTab.body.rows.find((x: any) => x.user_id === owner.id);
    expect(row.orders).toBe(1);
    expect(row.value).toBe(1000);
  });

  it("shows an unpaid invoice as outstanding, and a written-off one apart", async () => {
    const owner = await makeUser("CSM");
    const client = uniq("Money client ");
    const { order } = await makeOrder(owner);
    await prisma.order.update({ where: { id: order.id }, data: { client_name: client } });
    await prisma.invoice.create({
      data: {
        order_id: order.id,
        invoice_no: uniq("INV"),
        bill_amount: 1000,
        billing_date: new Date(),
        amount_received: 400,
        payment_received_at: new Date(),
      },
    });
    const q = `client=${encodeURIComponent(client)}&from=${day(-2)}&to=${day()}`;
    const res = await as(admin).get(`/api/reports/money?${q}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.outstanding).toBe(600);
    expect(res.body.kpis.received).toBe(400);
    expect(res.body.outstanding[0].order_id).toBe(order.id);

    await prisma.order.update({ where: { id: order.id }, data: { status: "Completed" } });
    const after = await as(admin).get(`/api/reports/money?${q}`);
    expect(after.body.kpis.outstanding).toBe(0);
    expect(after.body.kpis.written_off).toBe(600);
  });
});

describe("GET /api/reports/options", () => {
  it("lists CSMs and clients for the filters, to report readers only", async () => {
    const res = await as(accounts).get("/api/reports/options");
    expect(res.status).toBe(200);
    expect(res.body.csms.some((c: any) => c.id === csm.id)).toBe(true);
    expect(Array.isArray(res.body.clients)).toBe(true);
    expect((await as(csm).get("/api/reports/options")).status).toBe(403);
  });
});

describe("GET /api/reports/:tab/export", () => {
  it("sends an Excel workbook named for the tab and range", async () => {
    const res = await as(admin)
      .get("/api/reports/allocation/export?from=2026-11-01&to=2026-11-30")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("report_allocation_2026-11-01_to_2026-11-30.xlsx");
    // An xlsx file is a zip: it starts "PK".
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("checks the role before building the file", async () => {
    expect((await as(accounts).get("/api/reports/system/export")).status).toBe(403);
  });
});
