import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, prisma } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let operator: Awaited<ReturnType<typeof makeUser>>;
let paster: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  csm = await makeUser("CSM");
  om = await makeUser("OPERATION_MANAGER");
  operator = await makeUser("PRODUCTION");
  paster = await makeUser("PASTER");
});

describe("closing an order needs a written remark", () => {
  it("refuses a close with no remark text", async () => {
    const { order } = await makeOrder(csm);
    const res = await as(admin).put(`/api/orders/${order.id}/force-close`).send({ remarks: "Other" });
    expect(res.status).toBe(400);
  });

  it("refuses Extra / Less / Revised as a closing remark", async () => {
    const { order } = await makeOrder(csm);
    for (const remarks of ["ExtraAmount", "LessAmount", "Revised"]) {
      const res = await as(admin).put(`/api/orders/${order.id}/force-close`).send({ remarks, remarks_other_text: "client asked" });
      expect(res.status).toBe(400);
    }
  });

  it("force closes with a type and a remark", async () => {
    const { order } = await makeOrder(csm);
    const res = await as(admin).put(`/api/orders/${order.id}/force-close`).send({ remarks: "Sample", remarks_other_text: "Sample job, no bill" });
    expect(res.status).toBe(200);
    const saved = await prisma.order.findUnique({ where: { id: order.id } });
    expect(saved?.status).toBe("Completed");
    expect(saved?.remarks_other_text).toBe("Sample job, no bill");
  });
});

describe("order notes thread", () => {
  it("lets the CSM, admin and Operation Manager add and read notes", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(csm).post(`/api/orders/${order.id}/notes`).send({ body: "Client wants it by Friday" })).status).toBe(201);
    expect((await as(om).post(`/api/orders/${order.id}/notes`).send({ body: "Team booked" })).status).toBe(201);
    expect((await as(admin).post(`/api/orders/${order.id}/notes`).send({ body: "OK" })).status).toBe(201);
    const res = await as(csm).get(`/api/orders/${order.id}/notes`);
    expect(res.status).toBe(200);
    expect(res.body.notes.map((n: any) => n.body)).toEqual(["Client wants it by Friday", "Team booked", "OK"]);
    expect(res.body.notes[1].author_role).toBe("OPERATION_MANAGER");
    const detail = await as(admin).get(`/api/orders/${order.id}`);
    expect(detail.body.notes_count).toBe(3);
  });

  it("tells the order's CSM when someone else adds a note", async () => {
    const { order } = await makeOrder(csm);
    await as(admin).post(`/api/orders/${order.id}/notes`).send({ body: "Please call the client" });
    const n = await prisma.notification.findFirst({ where: { user_id: csm.id, order_id: order.id, title: { contains: "New note" } } });
    expect(n).not.toBeNull();
  });

  it("refuses an empty note", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(csm).post(`/api/orders/${order.id}/notes`).send({ body: "   " })).status).toBe(400);
  });

  it("keeps operators and field staff to orders they work on", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(operator).get(`/api/orders/${order.id}/notes`)).status).toBe(403);
    expect((await as(paster).get(`/api/orders/${order.id}/notes`)).status).toBe(403);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    await prisma.orderItemAssignment.create({ data: { order_item_id: item.id, user_id: operator.id } });
    expect((await as(operator).get(`/api/orders/${order.id}/notes`)).status).toBe(200);
  });
});

describe("order remark and CSM directory", () => {
  it("saves the optional order remark through the details patch", async () => {
    const { order } = await makeOrder(csm);
    const res = await as(csm).patch(`/api/orders/${order.id}/details`).send({ order_remark: "Fragile, pack well" });
    expect(res.status).toBe(200);
    const saved = await prisma.order.findUnique({ where: { id: order.id } });
    expect(saved?.order_remark).toBe("Fragile, pack well");
  });

  it("lists CSMs for every signed-in role", async () => {
    const res = await as(operator).get("/api/users/csm-directory");
    expect(res.status).toBe(200);
    expect(res.body.directory.some((d: any) => d.id === csm.id)).toBe(true);
  });
});
