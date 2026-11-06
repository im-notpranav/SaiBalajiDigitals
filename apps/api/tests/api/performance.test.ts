import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { objectStore } from "../../src/utils/object-store";
import { as, makeOrder, makeUser, prisma, uniq } from "./helpers";

let csm: Awaited<ReturnType<typeof makeUser>>;
let manager: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  csm = await makeUser("CSM");
  manager = await makeUser("PRODUCTION_MANAGER");
});

describe("order lists", () => {
  it("give the tables a count and a total, not whole item rows", async () => {
    const { order } = await makeOrder(csm);
    const res = await as(csm).get("/api/orders?limit=50");
    expect(res.status).toBe(200);
    const row = res.body.data.find((o: { id: number }) => o.id === order.id);
    expect(row.total_amount).toBe(1000);
    expect(row.items).toHaveLength(1);
    expect(Object.keys(row.items[0]).sort()).toEqual(["assignments", "id"]);
  });

  it("give production and the Assign Work page the whole rows", async () => {
    const { order } = await makeOrder(csm);
    const asManager = await as(manager).get("/api/orders?limit=50");
    expect(asManager.body.data.find((o: { id: number }) => o.id === order.id).items[0].media).toBeDefined();
    const asked = await as(csm).get("/api/orders?limit=50&items=full");
    expect(asked.body.data.find((o: { id: number }) => o.id === order.id).items[0].media).toBeDefined();
  });

  it("find orders by a search word, including a store's name", async () => {
    const { order, store } = await makeOrder(csm);
    const byStore = await as(csm).get(`/api/orders?q=${encodeURIComponent(store.store_name)}`);
    expect(byStore.status).toBe(200);
    expect(byStore.body.data.map((o: { id: number }) => o.id)).toEqual([order.id]);
    expect((await as(csm).get(`/api/orders/export?q=${encodeURIComponent(store.store_name)}`)).status).toBe(200);
  });

  it("cap how many one request can ask for", async () => {
    const res = await as(csm).get("/api/orders?limit=100000&page=0");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(200);
  });
});

describe("compression", () => {
  it("shrinks a long list, and leaves a small reply alone", async () => {
    for (let i = 0; i < 12; i++) await makeOrder(csm);
    const big = await as(csm).get("/api/orders?limit=50").set("Accept-Encoding", "gzip");
    expect(big.headers["content-encoding"]).toBe("gzip");
    const small = await request(app).get("/health").set("Accept-Encoding", "gzip");
    expect(small.headers["content-encoding"]).toBeUndefined();
  });
});

describe("login limits", () => {
  const attempt = (username: string) => request(app).post("/api/auth/login").send({ username, password: "wrong" });

  it("lock out one person's guesses, and nobody else", async () => {
    const victim = uniq("nobody");
    for (let i = 0; i < 10; i++) expect((await attempt(victim)).status).not.toBe(429);
    expect((await attempt(victim)).status).toBe(429);
    expect((await attempt(uniq("someone"))).status).not.toBe(429);
  });
});

describe("payment files", () => {
  const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(uniq("picture-bytes-"))]);

  async function raise() {
    const { order } = await makeOrder(csm);
    const res = await as(csm)
      .post("/api/payment-requests")
      .send({ upi_method: "UPI_ID", upi_id: "test@okaxis", purpose: "Travel to the site", order_id: order.id, amount: 500, bill_details_required: false, idempotency_key: uniq("idem-key-") });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.request.id as number;
  }
  const upload = (id: number, data: Buffer, by = csm) =>
    as(by).post(`/api/payment-requests/${id}/attachments?kind=BILL&name=bill.jpg`).set("Content-Type", "image/jpeg").send(data);

  it("go to object storage, not the database, and come back the same", async () => {
    const id = await raise();
    const data = JPEG();
    const res = await upload(id, data);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = await prisma.paymentAttachment.findFirstOrThrow({ where: { request_id: id } });
    expect(row.storage).toBe("r2");
    expect(row.storage_key).toMatch(new RegExp(`^payments/${id}/`));
    expect(await prisma.paymentAttachmentBlob.count({ where: { attachment_id: row.id } })).toBe(0);
    expect(await objectStore!.get(row.storage_key!)).toEqual(data);

    const back = await as(csm).get(`/api/payment-requests/${id}/attachments/${row.id}`).buffer(true);
    expect(back.status).toBe(200);
    expect(Buffer.from(back.body)).toEqual(data);
  });

  it("still open from the database when they were saved there", async () => {
    const id = await raise();
    const order = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });
    const data = JPEG();
    const row = await prisma.paymentAttachment.create({
      data: { request_id: id, order_id: order.order_id, kind: "BILL", original_name: "old.jpg", mime: "image/jpeg", size_bytes: data.length, sha256: uniq("sha"), storage: "db", uploaded_by: csm.id },
    });
    await prisma.paymentAttachmentBlob.create({ data: { attachment_id: row.id, data } });
    const back = await as(csm).get(`/api/payment-requests/${id}/attachments/${row.id}`).buffer(true);
    expect(back.status).toBe(200);
    expect(Buffer.from(back.body)).toEqual(data);
  });

  it("refused ones leave nothing behind", async () => {
    const id = await raise();
    const data = JPEG();
    expect((await upload(id, data)).status).toBe(201);
    expect((await upload(id, data)).status).toBe(409);
    expect(await prisma.paymentAttachment.count({ where: { request_id: id } })).toBe(1);

    const stranger = await makeUser("CSM");
    const before = await prisma.paymentAttachment.count();
    expect((await upload(id, JPEG(), stranger)).status).toBe(404);
    expect(await prisma.paymentAttachment.count()).toBe(before);
  });
});
