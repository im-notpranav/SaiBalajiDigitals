import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, onlyActiveCcm, prisma } from "./helpers";

let superAdmin: Awaited<ReturnType<typeof makeUser>>;
let admin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  superAdmin = await makeUser("ADMIN", { is_super_admin: true });
  admin = await makeUser("ADMIN");
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
});

describe("Operation Manager self-service (GAP-B02)", () => {
  it("can change their own profile", async () => {
    const res = await as(om).put("/api/users/me").send({ name: "Ops Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Ops Renamed");
  });

  it("can mark their notifications read", async () => {
    expect((await as(om).put("/api/notifications/read-all")).status).toBe(200);
  });

  it("is not refused the email export as a write", async () => {
    const res = await as(om).post("/api/orders/export/email").send({});
    expect(res.status).not.toBe(403);
  });

  it("still cannot change business records", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(om).put(`/api/orders/${order.id}/close`)).status).toBe(403);
  });
});

describe("accounts are the super admin's (D-01)", () => {
  it("refuses delete and deactivate to an ordinary Admin", async () => {
    const target = await makeUser("CSM");
    expect((await as(admin).delete(`/api/users/${target.id}`)).status).toBe(403);
    expect((await as(admin).put(`/api/users/${target.id}/status`).send({ is_active: false })).status).toBe(403);
  });

  it("lets the super admin deactivate", async () => {
    const target = await makeUser("CSM");
    expect((await as(superAdmin).put(`/api/users/${target.id}/status`).send({ is_active: false })).status).toBe(200);
  });
});

describe("the last active Cost Control Manager stays (BR-30)", () => {
  it("cannot be switched off, deleted or moved to another role", async () => {
    const ccm = await makeUser("COST_CONTROL_MANAGER");
    await onlyActiveCcm(ccm);

    const off = await as(superAdmin).put(`/api/users/${ccm.id}/status`).send({ is_active: false });
    expect(off.status).toBe(409);
    expect(off.body.message).toMatch(/only active Cost Control Manager/);
    expect((await as(superAdmin).delete(`/api/users/${ccm.id}`)).status).toBe(409);
    expect((await as(superAdmin).put(`/api/users/${ccm.id}`).send({ name: ccm.name, username: ccm.username, role: "CSM", phone: "9876543210", email: "ccm@example.com" })).status).toBe(409);

    // With a second one active, the first can go.
    await makeUser("COST_CONTROL_MANAGER");
    expect((await as(superAdmin).put(`/api/users/${ccm.id}/status`).send({ is_active: false })).status).toBe(200);
  });
});

describe("deleting orders (GAP-F01)", () => {
  it("is the super admin's alone", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(admin).delete(`/api/orders/${order.id}`)).status).toBe(403);
    expect((await as(superAdmin).delete(`/api/orders/${order.id}`)).status).toBe(200);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
  });

  it("refuses an order that has been invoiced", async () => {
    const { order, store } = await makeOrder(csm, { installed: true });
    const inv = await prisma.invoice.create({ data: { order_id: order.id, invoice_no: "INV-1", bill_amount: 1000 } });
    await prisma.orderStore.update({ where: { id: store.id }, data: { invoice_id: inv.id } });

    const res = await as(superAdmin).delete(`/api/orders/${order.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/invoice/i);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).not.toBeNull();
  });

  it("refuses an order with installed stores", async () => {
    const { order } = await makeOrder(csm, { installed: true });
    expect((await as(superAdmin).delete(`/api/orders/${order.id}`)).status).toBe(409);
  });
});
