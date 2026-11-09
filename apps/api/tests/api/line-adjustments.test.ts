import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, prisma } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let otherCsm: Awaited<ReturnType<typeof makeUser>>;
let accounts: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  csm = await makeUser("CSM");
  otherCsm = await makeUser("CSM");
  accounts = await makeUser("ACCOUNTS");
});

const itemOf = async (orderId: number) => prisma.orderItem.findFirstOrThrow({ where: { order_id: orderId } });
const totalOf = async (orderId: number) => (await as(admin).get(`/api/orders/${orderId}`)).body;

/** A store whose one ₹1,000 line is fully invoiced, so the order reads BillingCompleted. */
async function invoicedOrder() {
  const { order, store } = await makeOrder(csm, { installed: true });
  const inv = await prisma.invoice.create({
    data: { order_id: order.id, invoice_no: `INV-${order.id}`, bill_amount: 1000, billing_completed_at: new Date() },
  });
  await prisma.orderStore.update({ where: { id: store.id }, data: { invoice_id: inv.id } });
  await prisma.order.update({ where: { id: order.id }, data: { status: "BillingCompleted" } });
  return { order, store };
}

describe("line Extra / Less Amount", () => {
  it("a CSM request is billed at the plain amount until an admin approves it", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);

    const req = await as(csm)
      .post(`/api/orders/${order.id}/items/${item.id}/adjustment-request`)
      .send({ type: "ExtraAmount", amount: 250, reason: "Night installation" });
    expect(req.status).toBe(200);
    expect(req.body.remarks_confirmed).toBe(false);
    expect((await totalOf(order.id)).total_amount).toBe(1000);

    const told = await prisma.notification.findFirst({ where: { user_id: admin.id, order_id: order.id } });
    expect(told?.title).toContain("Amount change requested");

    // The admin approves at a different figure.
    const ok = await as(admin)
      .put(`/api/orders/${order.id}/items/${item.id}/remark`)
      .send({ remarks: "ExtraAmount", remarks_other_text: "Night installation", adjustment_amount: 200 });
    expect(ok.status).toBe(200);
    const after = await totalOf(order.id);
    expect(after.total_amount).toBe(1200);
    expect(after.loss_amount).toBe(0);
    expect(after.adjustment_amount).toBe(200);

    const decided = await prisma.notification.findFirst({ where: { user_id: csm.id, order_id: order.id, title: { contains: "Request decided" } } });
    expect(decided?.body).toContain("approved at ₹200.00");
  });

  it("rejecting a request leaves the line billed in full and tells the CSM why", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);
    await as(csm)
      .post(`/api/orders/${order.id}/items/${item.id}/adjustment-request`)
      .send({ type: "LessAmount", amount: 300, reason: "Client asked" });

    const no = await as(admin)
      .put(`/api/orders/${order.id}/items/${item.id}/remark`)
      .send({ remarks: null, decision_note: "Rate already discounted" });
    expect(no.status).toBe(200);
    expect((await totalOf(order.id)).total_amount).toBe(1000);
    const told = await prisma.notification.findFirst({ where: { user_id: csm.id, order_id: order.id, title: { contains: "Request decided" } } });
    expect(told?.body).toContain("rejected");
    expect(told?.body).toContain("Rate already discounted");
  });

  it("an approved Less Amount comes off the bill, and cannot exceed the line", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);
    const tooMuch = await as(admin)
      .put(`/api/orders/${order.id}/items/${item.id}/remark`)
      .send({ remarks: "LessAmount", remarks_other_text: "Goodwill", adjustment_amount: 1500 });
    expect(tooMuch.status).toBe(400);

    await as(admin)
      .put(`/api/orders/${order.id}/items/${item.id}/remark`)
      .send({ remarks: "LessAmount", remarks_other_text: "Goodwill", adjustment_amount: 150 });
    const after = await totalOf(order.id);
    expect(after.total_amount).toBe(850);
    expect(after.loss_amount).toBe(0);
  });

  it("needs a reason and a figure", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);
    const noReason = await as(admin).put(`/api/orders/${order.id}/items/${item.id}/remark`).send({ remarks: "ExtraAmount", adjustment_amount: 10 });
    expect(noReason.status).toBe(400);
    const noFigure = await as(admin).put(`/api/orders/${order.id}/items/${item.id}/remark`).send({ remarks: "ExtraAmount", remarks_other_text: "x" });
    expect(noFigure.status).toBe(400);
  });

  it("only the order's CSM can request, and not on a line that already has a remark", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);
    const stranger = await as(otherCsm)
      .post(`/api/orders/${order.id}/items/${item.id}/adjustment-request`)
      .send({ type: "ExtraAmount", amount: 10, reason: "x" });
    expect(stranger.status).toBe(403);

    await as(admin).put(`/api/orders/${order.id}/items/${item.id}/remark`).send({ remarks: "Reprint" });
    const taken = await as(csm)
      .post(`/api/orders/${order.id}/items/${item.id}/adjustment-request`)
      .send({ type: "ExtraAmount", amount: 10, reason: "x" });
    expect(taken.status).toBe(409);
  });

  it("the five loss types still take the whole line off the bill", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);
    await as(admin).put(`/api/orders/${order.id}/items/${item.id}/remark`).send({ remarks: "Sample" });
    const after = await totalOf(order.id);
    expect(after.total_amount).toBe(0);
    expect(after.loss_amount).toBe(1000);
  });
});

describe("Revised", () => {
  it("an admin changing a saved line's rate with Revised bills the new amount and keeps the old", async () => {
    const { order, store } = await makeOrder(csm);
    const item = await itemOf(order.id);
    const line = { id: item.id, store_id: store.id, media: "Flex", width_inches: 120, height_inches: 120, qty: 1 };

    const bare = await as(admin).put(`/api/orders/${order.id}`).send({ items: [{ ...line, rate: 12 }] });
    expect(bare.status).toBe(400);

    const res = await as(admin)
      .put(`/api/orders/${order.id}`)
      .send({ items: [{ ...line, rate: 12, remarks: "Revised", remarks_other_text: "Rate agreed at 12" }] });
    expect(res.status).toBe(200);
    expect(res.body.total_amount).toBe(1200);
    expect(res.body.loss_amount).toBe(0);
    const saved = await itemOf(order.id);
    expect(Number(saved.original_amount)).toBe(1000);
    expect(saved.remarks_confirmed).toBe(true);
  });

  it("is refused on a new line, and for a CSM", async () => {
    const { order, store } = await makeOrder(csm);
    const item = await itemOf(order.id);
    const keep = { id: item.id, store_id: store.id, media: "Flex", width_inches: 120, height_inches: 120, qty: 1, rate: 10 };
    const fresh = { store_id: store.id, media: "Vinyl", width_inches: 12, height_inches: 12, qty: 1, rate: 10, remarks: "Revised", remarks_other_text: "x" };
    const asAdmin = await as(admin).put(`/api/orders/${order.id}`).send({ items: [keep, fresh] });
    expect(asAdmin.status).toBe(400);
    const asCsm = await as(csm).put(`/api/orders/${order.id}`).send({ items: [keep, fresh] });
    expect(asCsm.status).toBe(403);
  });
});

describe("whole-order adjustments", () => {
  it("a CSM request waits for an admin; approval adds it to the chosen store", async () => {
    const { order, store } = await makeOrder(csm);
    const req = await as(csm)
      .post(`/api/orders/${order.id}/adjustments`)
      .send({ order_store_id: store.id, type: "ExtraAmount", amount: 500, reason: "Transport" });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("Requested");
    expect((await totalOf(order.id)).total_amount).toBe(1000);

    const ok = await as(admin)
      .patch(`/api/orders/${order.id}/adjustments/${req.body.id}`)
      .send({ action: "approve", amount: 400 });
    expect(ok.status).toBe(200);
    const after = await totalOf(order.id);
    expect(after.total_amount).toBe(1400);
    expect(after.stores[0].total_amount).toBe(1400);
    const saved = await prisma.orderAdjustment.findUniqueOrThrow({ where: { id: req.body.id } });
    expect(Number(saved.requested_amount)).toBe(500);
  });

  it("rejecting needs a note and changes nothing on the bill", async () => {
    const { order, store } = await makeOrder(csm);
    const req = await as(csm)
      .post(`/api/orders/${order.id}/adjustments`)
      .send({ order_store_id: store.id, type: "LessAmount", amount: 100, reason: "Delay" });
    const bare = await as(admin).patch(`/api/orders/${order.id}/adjustments/${req.body.id}`).send({ action: "reject" });
    expect(bare.status).toBe(400);
    const no = await as(admin).patch(`/api/orders/${order.id}/adjustments/${req.body.id}`).send({ action: "reject", note: "Not agreed" });
    expect(no.status).toBe(200);
    expect((await totalOf(order.id)).total_amount).toBe(1000);
  });

  it("a store from another order is refused", async () => {
    const { order } = await makeOrder(csm);
    const { store: elsewhere } = await makeOrder(csm);
    const res = await as(admin)
      .post(`/api/orders/${order.id}/adjustments`)
      .send({ order_store_id: elsewhere.id, type: "ExtraAmount", amount: 10, reason: "x" });
    expect(res.status).toBe(400);
  });

  it("an admin change on an invoiced order moves it to Pending and tells Accounts", async () => {
    const { order, store } = await invoicedOrder();
    const res = await as(admin)
      .post(`/api/orders/${order.id}/adjustments`)
      .send({ order_store_id: store.id, type: "LessAmount", amount: 100, reason: "Late delivery" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("Approved");
    const now = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(now.status).toBe("Pending");
    const told = await prisma.notification.findFirst({ where: { user_id: accounts.id, order_id: order.id } });
    expect(told?.title).toContain("Invoice no longer matches");
  });
});

describe("loss report", () => {
  it("keeps adjustments out of the loss total", async () => {
    const { order } = await makeOrder(csm);
    const item = await itemOf(order.id);
    await as(admin)
      .put(`/api/orders/${order.id}/items/${item.id}/remark`)
      .send({ remarks: "LessAmount", remarks_other_text: "Goodwill", adjustment_amount: 75 });
    const report = await as(admin).get("/api/admin/loss-report");
    expect(report.status).toBe(200);
    expect(report.body.items.some((i: any) => i.id === item.id)).toBe(false);
    const row = report.body.adjustments.find((a: any) => a.key === `item-${item.id}`);
    expect(row?.effect).toBe(-75);
  });
});
