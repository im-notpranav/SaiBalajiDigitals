import { beforeAll, describe, expect, it } from "vitest";
import { as, makeUser, prisma, uniq } from "./helpers";
import { deriveYY, generateOrderId } from "../../src/utils/order-sequence";

let admin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let otherCsm: Awaited<ReturnType<typeof makeUser>>;

/** A number no test or sequence will reach by accident. */
let custom = 0;
const customNo = () => `ORD9${String(Date.now()).slice(-9)}${++custom}`;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
  otherCsm = await makeUser("CSM");
  const year_code = deriveYY();
  await prisma.orderSequence.upsert({ where: { id: 1 }, update: {}, create: { id: 1, year_code, last_number: 12 } });
});

const start = (over: Record<string, unknown> = {}) =>
  as(admin).post("/api/orders/start").send({ client_name: uniq("Client "), csm_user_id: csm.id, ...over });
const ids = (res: { body: { data: { id: number }[] } }) => res.body.data.map((o) => o.id);

describe("an admin starting an order", () => {
  it("gives it to the CSM, tells them, and records the admin in the audit log", async () => {
    const res = await start({ order_no: customNo() });
    expect(res.status).toBe(201);
    expect(res.body.created_by).toBe(csm.id);
    expect(res.body.creator_name).toBe(csm.name);
    expect(res.body.status).toBe("Active");

    const audit = await prisma.auditLog.findFirst({ where: { table_name: "Order", record_id: res.body.id, action: "INSERT" } });
    expect(audit?.changed_by).toBe(admin.id);
    const told = await prisma.notification.findFirst({ where: { user_id: csm.id, order_id: res.body.id } });
    expect(told?.title).toContain(res.body.order_no);
  });

  it("takes the next in the series when no number is given", async () => {
    const res = await start({ order_no: "  " });
    expect(res.status).toBe(201);
    expect(res.body.order_no).toMatch(/^ORD\d{6,}$/);
  });

  it("accepts lower case, and refuses anything but ORD and digits", async () => {
    const no = customNo();
    const res = await start({ order_no: no.toLowerCase() });
    expect(res.status).toBe(201);
    expect(res.body.order_no).toBe(no);
    for (const bad of ["ABC123", "ORD", "ORD12A", "ORD 12"]) {
      expect((await start({ order_no: bad })).status).toBe(400);
    }
  });

  it("refuses a number already used", async () => {
    const no = customNo();
    expect((await start({ order_no: no })).status).toBe(201);
    const again = await start({ order_no: no });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already used/);
  });

  it("needs an active CSM", async () => {
    expect((await start({ csm_user_id: om.id })).status).toBe(400);
    const gone = await makeUser("CSM", { is_active: false });
    expect((await start({ csm_user_id: gone.id })).status).toBe(400);
  });

  it("is for admins only", async () => {
    const body = { client_name: "Acme", csm_user_id: csm.id };
    expect((await as(csm).post("/api/orders/start").send(body)).status).toBe(403);
    expect((await as(om).post("/api/orders/start").send(body)).status).toBe(403);
  });

  it("lets only that CSM finish it, and tells production once it has items", async () => {
    const { body: order } = await start({ order_no: customNo() });
    expect(ids(await as(csm).get("/api/orders"))).toContain(order.id);
    expect(ids(await as(otherCsm).get("/api/orders"))).not.toContain(order.id);

    const added = await as(csm).post(`/api/orders/${order.id}/stores`).send({ store_name: "Malakpet", location: "Bajaj" });
    expect(added.status).toBe(201);
    const item = { media: "Vinyl", width_inches: 12, height_inches: 12, qty: 1, rate: 50, store_id: added.body.id };
    expect((await as(otherCsm).put(`/api/orders/${order.id}`).send({ items: [item] })).status).toBe(403);

    const makers = await makeUser("PRODUCTION");
    expect(await prisma.notification.count({ where: { user_id: makers.id, order_id: order.id } })).toBe(0);
    const saved = await as(csm).put(`/api/orders/${order.id}`).send({ items: [item] });
    expect(saved.status).toBe(200);
    expect(await prisma.notification.count({ where: { user_id: makers.id, order_id: order.id } })).toBe(1);
  });
});

describe("the order number sequence", () => {
  it("skips a number an admin has already typed", async () => {
    const first = await generateOrderId();
    const yy = first.slice(3, 5);
    const n = parseInt(first.slice(5), 10);
    const typed = `ORD${yy}${String(n + 1).padStart(4, "0")}`;
    expect((await start({ order_no: typed })).status).toBe(201);

    const seq = await as(admin).get("/api/admin/order-sequence");
    expect(seq.body.next_order_number).toBe(`ORD${yy}${String(n + 2).padStart(4, "0")}`);
    expect(await generateOrderId()).toBe(`ORD${yy}${String(n + 2).padStart(4, "0")}`);
  });
});
