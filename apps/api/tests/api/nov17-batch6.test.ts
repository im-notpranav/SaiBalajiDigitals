import { beforeAll, describe, expect, it } from "vitest";
import { addMasters, as, makeUser, prisma, uniq } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let otherCsm: Awaited<ReturnType<typeof makeUser>>;
let operator: Awaited<ReturnType<typeof makeUser>>;
let otherOperator: Awaited<ReturnType<typeof makeUser>>;
let pm: Awaited<ReturnType<typeof makeUser>>;

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
  otherCsm = await makeUser("CSM");
  operator = await makeUser("PRODUCTION");
  otherOperator = await makeUser("PRODUCTION");
  pm = await makeUser("PRODUCTION_MANAGER");
  await addMasters({ media: ["Flex"], locations: ["Hyderabad"] });
  await prisma.area.upsert({ where: { name: "Vizag Far" }, update: { locality: "NON_LOCAL" }, create: { name: "Vizag Far", locality: "NON_LOCAL" } });
});

async function order(client: string, by: { id: number; name: string }, opts: { days?: number; location?: string } = {}) {
  return prisma.order.create({
    data: {
      order_no: uniq("B6"),
      client_name: client,
      date: daysAgo(opts.days ?? 0),
      created_by: by.id,
      creator_name: by.name,
      status: "Active",
      stores: { create: [{ s_no: 1, store_name: "Main", location: opts.location ?? "Hyderabad" }] },
    },
    include: { stores: true },
  });
}

describe("pending board", () => {
  it("groups open orders by CSM and locality with aging tones", async () => {
    const client = uniq("Pending Client ");
    const a = await order(client, csm, { days: 2 });
    const b = await order(client, csm, { days: 8, location: "Vizag Far" });
    const c = await order(client, csm, { days: 15 });
    expect((await as(csm).get("/api/dashboard/pending-by-csm")).status).toBe(403);
    const res = await as(om).get("/api/dashboard/pending-by-csm");
    expect(res.status).toBe(200);
    const mine = res.body.csms.find((g: any) => g.csm_id === csm.id);
    const tone = (id: number) => [...mine.local, ...mine.non_local].find((r: any) => r.id === id)?.tone;
    expect(tone(a.id)).toBe("green");
    expect(tone(b.id)).toBe("orange");
    expect(tone(c.id)).toBe("red");
    expect(mine.non_local.map((r: any) => r.id)).toContain(b.id);
    expect(mine.local[0].days).toBeGreaterThanOrEqual(mine.local[mine.local.length - 1].days);
  });
});

describe("day sheets", () => {
  it("lists a CSM's orders of the day, and keeps their own rows private", async () => {
    const o = await order(uniq("Sheet Client "), csm);
    const add = await as(csm).post("/api/day-sheets").send({ activity: "Follow-up", client_name: "Big C", note: "Called about payment", time: "11:30" });
    expect(add.status).toBe(201);
    expect((await as(csm).post("/api/day-sheets").send({ note: "Future", day: "2099-01-01" })).status).toBe(400);

    const sheet = await as(csm).get(`/api/day-sheets?day=${today()}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.entries.map((e: any) => e.note)).toContain("Called about payment");
    expect(sheet.body.orders.map((x: any) => x.id)).toContain(o.id);

    expect((await as(otherCsm).get(`/api/day-sheets?user=${csm.id}`)).status).toBe(403);
    expect((await as(otherCsm).delete(`/api/day-sheets/${add.body.entry.id}`)).status).toBe(404);
    const byOm = await as(om).get(`/api/day-sheets?user=${csm.id}&day=${today()}`);
    expect(byOm.status).toBe(200);
    expect(byOm.body.can_edit).toBe(false);
    const people = await as(om).get(`/api/day-sheets/people?day=${today()}`);
    expect(people.body.people.find((p: any) => p.id === csm.id).entries).toBeGreaterThan(0);
  });

  it("a paster writes a note of the day's work", async () => {
    const paster = await makeUser("PASTER");
    const res = await as(paster).post("/api/day-sheets").send({ note: "Pasted 4 stores at Ameerpet" });
    expect(res.status).toBe(201);
    expect(res.body.entry.activity).toBe("Note");
    const sheet = await as(paster).get("/api/day-sheets");
    expect(sheet.body.entries).toHaveLength(1);
  });
});

describe("new report tabs", () => {
  it("printing: an operator sees only their own lines; the PM may pick one", async () => {
    const o = await order(uniq("Print Client "), csm);
    const store = o.stores[0]!;
    const line = (s_no: number, by: number) =>
      prisma.orderItem.create({
        data: {
          order_id: o.id,
          order_store_id: store.id,
          s_no,
          media: "Flex",
          width_inches: 12,
          height_inches: 12,
          qty: 1,
          total_sft: 1,
          rate: 10,
          amount: 10,
          started_at: new Date(),
          started_by: by,
        },
      });
    const mineLine = await line(1, operator.id);
    const theirs = await line(2, otherOperator.id);
    const mine = await as(operator).get(`/api/reports/printing?operator=${otherOperator.id}`);
    expect(mine.status).toBe(200);
    const ids = mine.body.rows.map((r: any) => r.line_id);
    expect(ids).toContain(mineLine.id);
    expect(ids).not.toContain(theirs.id);

    const picked = await as(pm).get(`/api/reports/printing?operator=${otherOperator.id}`);
    expect(picked.body.rows.map((r: any) => r.line_id)).toEqual(expect.arrayContaining([theirs.id]));
    expect(picked.body.rows.map((r: any) => r.line_id)).not.toContain(mineLine.id);
    expect((await as(csm).get("/api/reports/printing")).status).toBe(403);
  });

  it("delay and turnover answer for the admin", async () => {
    const client = uniq("Delay Client ");
    await order(client, csm, { days: 1 });
    const delay = await as(admin).get(`/api/reports/delay?client=${encodeURIComponent(client)}&from=${new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)}&to=${today()}`);
    expect(delay.status).toBe(200);
    expect(delay.body.summary.map((s: any) => s.stage)).toEqual(["production", "installation", "invoice", "payment"]);
    expect(delay.body.rows[0].current).toBe("production");

    const turnover = await as(admin).get(`/api/reports/turnover?client=${encodeURIComponent(client)}`);
    expect(turnover.status).toBe(200);
    expect(turnover.body.totals.orders).toBe(1);
    expect(turnover.body.by_csm[0].csm).toBe(csm.name);
  });

  it("delay limits are an admin setting", async () => {
    const get = await as(om).get("/api/admin/delay-limits");
    expect(get.body.delay_limits).toMatchObject({ production: expect.any(Number) });
    expect((await as(admin).put("/api/admin/delay-limits").send({ delay_limits: { production: 0, installation: 3, invoice: 5, payment: 45 } })).status).toBe(400);
    const ok = await as(admin).put("/api/admin/delay-limits").send({ delay_limits: { production: 4, installation: 3, invoice: 5, payment: 45 } });
    expect(ok.body.delay_limits.production).toBe(4);
  });
});
