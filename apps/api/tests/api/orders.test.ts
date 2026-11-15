import { beforeAll, describe, expect, it } from "vitest";
import { addMasters, as, makeUser, prisma, uniq } from "./helpers";
import { deriveYY, generateOrderId } from "../../src/utils/order-sequence";

let admin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let otherCsm: Awaited<ReturnType<typeof makeUser>>;

/** A this-year number from 9001 up, which the sequence (starting at 0013) won't reach in a run. */
let custom = 0;
const customNo = () => `ORD${deriveYY()}${9000 + ++custom}`;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
  otherCsm = await makeUser("CSM");
  const year_code = deriveYY();
  await prisma.orderSequence.upsert({ where: { id: 1 }, update: {}, create: { id: 1, year_code, last_number: 12 } });
  // Orders may only use names the admin has put in the Master Library.
  await addMasters({ locations: ["Bajaj", "Main Road"], media: ["Vinyl"] });
});

const start = async (over: Record<string, unknown> = {}) => {
  const client_name = uniq("Client ");
  await addMasters({ clients: [client_name] });
  return as(admin).post("/api/orders/start").send({ client_name, csm_user_id: csm.id, ...over });
};
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
    expect(res.body.order_no).toMatch(new RegExp(`^ORD${deriveYY()}\\d{4}$`));
  });

  it("accepts lower case, and refuses anything but ORD, this year's code and 4 digits", async () => {
    const no = customNo();
    const res = await start({ order_no: no.toLowerCase() });
    expect(res.status).toBe(201);
    expect(res.body.order_no).toBe(no);
    const yy = deriveYY();
    const lastYear = String(Number(yy) - 1).padStart(2, "0");
    for (const bad of ["ABC123", "ORD", "ORD12A", "ORD 12", `ORD${yy}00001`, `ORD${yy}0000`, `ORD${lastYear}0123`]) {
      expect((await start({ order_no: bad })).status).toBe(400);
    }
  });

  it("lists it under ?waiting=1 until the CSM adds a store", async () => {
    const { body: order } = await start({ order_no: customNo() });
    expect(ids(await as(admin).get("/api/orders?waiting=1"))).toContain(order.id);
    expect(ids(await as(csm).get("/api/orders?waiting=1"))).toContain(order.id);
    await as(csm).post(`/api/orders/${order.id}/stores`).send({ store_name: "Ameerpet", location: "Main Road" });
    expect(ids(await as(admin).get("/api/orders?waiting=1"))).not.toContain(order.id);
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

describe("names come from the Master Library", () => {
  const missingOf = (res: { body: { missing?: { kind: string; name: string }[] } }) => res.body.missing ?? [];

  it("refuses a client the admin has not added, and saves the master's spelling", async () => {
    const unknown = await as(admin).post("/api/orders/start").send({ client_name: uniq("Eric Traders "), csm_user_id: csm.id });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toMatch(/^Client '.+' is not in Master Library\. Ask the admin to add it\.$/);
    expect(missingOf(unknown)[0]!.kind).toBe("CLIENT");

    const name = uniq("Spelt Right ");
    await addMasters({ clients: [name] });
    const ok = await as(admin).post("/api/orders/start").send({ client_name: `  ${name.toLowerCase()}`, csm_user_id: csm.id });
    expect(ok.status).toBe(201);
    expect(ok.body.client_name).toBe(name);
  });

  it("refuses an unknown store location or media, naming each one", async () => {
    const body = {
      client_name: uniq("Client "),
      date: new Date().toISOString().slice(0, 10),
      stores: [{ store_name: "KPHB", location: uniq("Nowhere "), items: [{ media: uniq("Sunboard "), width_inches: 12, height_inches: 12, qty: 1, rate: 10 }] }],
    };
    await addMasters({ clients: [body.client_name] });
    const res = await as(csm).post("/api/orders").send(body);
    expect(res.status).toBe(400);
    expect(missingOf(res).map((m) => m.kind)).toEqual(["LOCATION", "MEDIA"]);
    expect(res.body.message).toContain("Ask the admin to add them.");

    const { body: order } = await start({ order_no: customNo() });
    expect((await as(csm).post(`/api/orders/${order.id}/stores`).send({ store_name: "X", location: uniq("Nowhere ") })).status).toBe(400);
    const store = await as(csm).post(`/api/orders/${order.id}/stores`).send({ store_name: "X", location: "bajaj" });
    expect(store.status).toBe(201);
    expect(store.body.location).toBe("Bajaj");
    const item = { media: uniq("Sunboard "), width_inches: 12, height_inches: 12, qty: 1, rate: 10, store_id: store.body.id };
    expect((await as(csm).put(`/api/orders/${order.id}`).send({ items: [item] })).status).toBe(400);
  });

  it("keeps an archived name already on an order, but will not take it anew", async () => {
    const client = uniq("Old Client ");
    const place = uniq("Old Place ");
    const media = uniq("Old Media ");
    await addMasters({ clients: [client], locations: [place], media: [media] });
    const { body: order } = await as(admin).post("/api/orders/start").send({ client_name: client, csm_user_id: csm.id });
    const { body: store } = await as(csm).post(`/api/orders/${order.id}/stores`).send({ store_name: "Main", location: place });
    const line = { media, width_inches: 12, height_inches: 12, qty: 1, rate: 10, store_id: store.id };
    expect((await as(csm).put(`/api/orders/${order.id}`).send({ items: [line] })).status).toBe(200);
    const [saved] = await prisma.orderItem.findMany({ where: { order_id: order.id } });

    await prisma.client.update({ where: { name: client }, data: { is_active: false } });
    await prisma.area.update({ where: { name: place }, data: { is_active: false } });
    await prisma.media.update({ where: { name: media }, data: { is_active: false } });

    // Unchanged names save; the PO and a new line go in.
    expect((await as(csm).patch(`/api/orders/${order.id}/details`).send({ client_name: client, po_number: "PO-1" })).status).toBe(200);
    expect((await as(csm).patch(`/api/orders/${order.id}/stores/${store.id}`).send({ location: place, po_number: "S-1" })).status).toBe(200);
    const keep = { ...line, id: saved!.id };
    expect((await as(csm).put(`/api/orders/${order.id}`).send({ items: [keep, { ...line, media: "Vinyl" }] })).status).toBe(200);

    // Picking the archived name again elsewhere is refused.
    const { body: other } = await start({ order_no: customNo() });
    expect((await as(csm).patch(`/api/orders/${other.id}/details`).send({ client_name: client })).status).toBe(400);
    expect((await as(csm).post(`/api/orders/${other.id}/stores`).send({ store_name: "Main", location: place })).status).toBe(400);
  });
});

describe("pick-lists", () => {
  it("lists only active names, A to Z, and locations reach the CSM", async () => {
    const tag = uniq("pick");
    await addMasters({ clients: [`${tag} B`, `${tag} A`, `${tag} C`], locations: [`${tag} Zone`] });
    await prisma.client.update({ where: { name: `${tag} C` }, data: { is_active: false } });
    const clients = await as(csm).get(`/api/clients?q=${encodeURIComponent(tag)}`);
    expect(clients.body.clients).toEqual([`${tag} A`, `${tag} B`]);

    const locations = await as(csm).get(`/api/masters/locations?q=${encodeURIComponent(tag)}`);
    expect(locations.status).toBe(200);
    expect(locations.body.locations).toEqual([{ name: `${tag} Zone`, locality: "LOCAL" }]);
    expect((await as(om).get("/api/masters/locations")).status).toBe(200);
  });

  it("areas are added and changed by the admin only; the Operation Manager reads them", async () => {
    const area = { name: uniq("Area "), locality: "LOCAL" };
    expect((await as(om).post("/api/masters/areas").send(area)).status).toBe(403);
    expect((await as(om).get("/api/masters/areas")).status).toBe(200);
    const made = await as(admin).post("/api/masters/areas").send(area);
    expect(made.status).toBe(201);
    expect((await as(om).patch(`/api/masters/areas/${made.body.id}`).send({ district: "X" })).status).toBe(403);
  });
});
