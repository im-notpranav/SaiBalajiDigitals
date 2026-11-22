import { beforeAll, describe, expect, it } from "vitest";
import { addMasters, as, makeOrder, makeUser, prisma } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let otherCsm: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;

let dayNo = 0;
/** Far-future days, one per job, so nothing here overlaps other files' jobs. */
const nextDay = () => new Date(Date.UTC(2034, 4, ++dayNo)).toISOString().slice(0, 10);

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  csm = await makeUser("CSM");
  otherCsm = await makeUser("CSM");
  om = await makeUser("OPERATION_MANAGER");
  await addMasters({ clients: ["Test client"], media: ["Flex", "Vinyl"], locations: ["Hyderabad"] });
});

describe("a CSM's essential changes wait for the admin", () => {
  it("takes a new line straight onto a saved order, but not a changed saved line", async () => {
    const { order, store } = await makeOrder(csm);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    const saved = { id: item.id, media: item.media, width_inches: Number(item.width_inches), height_inches: Number(item.height_inches), qty: Number(item.qty), rate: Number(item.rate) };
    const added = await as(csm).put(`/api/orders/${order.id}`).send({
      items: [saved, { store_id: store.id, media: "Vinyl", width_inches: 12, height_inches: 12, qty: 1, rate: 50 }],
    });
    expect(added.status).toBe(200);
    expect(await prisma.orderItem.count({ where: { order_id: order.id } })).toBe(2);

    const changed = await as(csm).put(`/api/orders/${order.id}`).send({ items: [{ ...saved, rate: saved.rate + 1 }] });
    expect(changed.status).toBe(403);
    expect(changed.body.needs_approval).toBe(true);
  });

  it("shows one request with its payload for the compare page", async () => {
    const { order } = await makeOrder(csm);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    const create = await as(csm).post(`/api/orders/${order.id}/change-requests`).send({
      kind: "LINE_EDIT",
      reason: "Bigger board",
      payload: { items: [{ id: item.id, media: "Flex", width_inches: 144, height_inches: 120, qty: 1, rate: 10 }] },
    });
    expect(create.status).toBe(201);
    const view = await as(admin).get(`/api/change-requests/view/change/${create.body.request.id}`);
    expect(view.status).toBe(200);
    expect(view.body.request.payload.items[0].width_inches).toBe(144);
    expect(view.body.request.order.id).toBe(order.id);
    expect((await as(csm).get(`/api/change-requests/view/change/${create.body.request.id}`)).status).toBe(403);
    expect((await as(admin).get(`/api/change-requests/view/line_remark/${item.id}`)).status).toBe(404);
    expect((await as(admin).get("/api/change-requests/view/nope/1")).status).toBe(400);
  });

  it("gives each pending order its stage on the OM board", async () => {
    const { order } = await makeOrder(csm);
    const res = await as(om).get("/api/dashboard/pending-by-csm");
    expect(res.status).toBe(200);
    const row = res.body.csms.flatMap((g: any) => [...g.local, ...g.non_local]).find((r: any) => r.id === order.id);
    expect(row?.stage).toBe("unassigned");
  });

  it("takes a new store from the order CSM only", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(otherCsm).post(`/api/orders/${order.id}/stores`).send({ store_name: "Branch 2", location: "Hyderabad" })).status).toBe(403);
    const ok = await as(csm).post(`/api/orders/${order.id}/stores`).send({ store_name: "Branch 2", location: "Hyderabad" });
    expect(ok.status).toBe(201);
  });

  it("refuses a store rename but still takes a PO", async () => {
    const { order, store } = await makeOrder(csm);
    expect((await as(csm).patch(`/api/orders/${order.id}/stores/${store.id}`).send({ store_name: "Renamed" })).status).toBe(403);
    expect((await as(csm).patch(`/api/orders/${order.id}/stores/${store.id}`).send({ po_number: "PO-9" })).status).toBe(200);
  });

  it("applies an approved line edit as the admin, marking changed lines Revised", async () => {
    const { order, store } = await makeOrder(csm);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    const create = await as(csm).post(`/api/orders/${order.id}/change-requests`).send({
      kind: "LINE_EDIT",
      reason: "Client agreed a lower rate",
      payload: {
        items: [
          { id: item.id, media: "Flex", width_inches: 120, height_inches: 120, qty: 1, rate: 8 },
          { store_id: store.id, media: "Vinyl", width_inches: 12, height_inches: 12, qty: 2, rate: 50 },
        ],
      },
    });
    expect(create.status).toBe(201);
    expect(create.body.request.summary).toMatch(/rate ₹10 → ₹8/);
    expect(create.body.request.summary).toMatch(/New line/);

    const queue = await as(admin).get("/api/change-requests");
    expect(queue.body.requests.some((r: any) => r.source === "change" && r.id === create.body.request.id)).toBe(true);

    const ok = await as(admin).post(`/api/change-requests/${create.body.request.id}/approve`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.request.status).toBe("APPROVED");
    const lines = await prisma.orderItem.findMany({ where: { order_id: order.id }, orderBy: { id: "asc" } });
    expect(lines).toHaveLength(2);
    expect(Number(lines[0]!.rate)).toBe(8);
    expect(lines[0]!.remarks).toBe("Revised");
    expect(Number(lines[1]!.amount)).toBe(100);
    const told = await prisma.notification.findFirst({ where: { user_id: csm.id, title: { contains: "approved" } } });
    expect(told).not.toBeNull();
    // Approving twice changes nothing.
    expect((await as(admin).post(`/api/change-requests/${create.body.request.id}/approve`).send({})).status).toBe(409);
  });

  it("rejects with a note and leaves the order alone", async () => {
    const { order } = await makeOrder(csm);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    const create = await as(csm).post(`/api/orders/${order.id}/change-requests`).send({
      kind: "LINE_EDIT",
      reason: "Wrong size",
      payload: { items: [{ id: item.id, media: "Flex", width_inches: 60, height_inches: 120, qty: 1, rate: 10 }] },
    });
    expect(create.status).toBe(201);
    expect((await as(admin).post(`/api/change-requests/${create.body.request.id}/reject`).send({})).status).toBe(400);
    expect((await as(admin).post(`/api/change-requests/${create.body.request.id}/reject`).send({ note: "Size is right" })).status).toBe(200);
    const same = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(same.width_inches)).toBe(120);
  });

  it("does not let another CSM ask on someone else's order", async () => {
    const { order } = await makeOrder(csm);
    expect((await as(otherCsm).post(`/api/orders/${order.id}/change-requests`).send({ kind: "OTHER", reason: "Please call me" })).status).toBe(403);
  });
});

describe("Extra / Less Amount belong to the whole order", () => {
  it("refuses them on a line and takes Reprint as a line request", async () => {
    const { order } = await makeOrder(csm);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    const less = await as(csm).post(`/api/orders/${order.id}/items/${item.id}/adjustment-request`).send({ type: "LessAmount", amount: 100, reason: "discount" });
    expect(less.status).toBe(400);
    const reprint = await as(csm).post(`/api/orders/${order.id}/items/${item.id}/adjustment-request`).send({ type: "Reprint", reason: "Colour was off" });
    expect(reprint.status).toBe(200);
    expect(reprint.body.remarks).toBe("Reprint");
    expect(reprint.body.remarks_confirmed).toBe(false);
  });

  it("takes a whole-order Less Amount that lowers the order, not the line", async () => {
    const { order, store } = await makeOrder(csm);
    const res = await as(csm).post(`/api/orders/${order.id}/adjustments`).send({ order_store_id: store.id, type: "LessAmount", amount: 200, reason: "Agreed discount" });
    expect(res.status).toBeLessThan(300);
    const adj = await prisma.orderAdjustment.findFirstOrThrow({ where: { order_id: order.id } });
    const decided = await as(admin).patch(`/api/orders/${order.id}/adjustments/${adj.id}`).send({ action: "approve", amount: 200 });
    expect(decided.status).toBeLessThan(300);
    const detail = await as(admin).get(`/api/orders/${order.id}`);
    expect(detail.body.total_amount).toBe(800);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    expect(Number(item.amount)).toBe(1000);
  });
});

describe("combining orders", () => {
  it("moves the second order's stores in and closes it as merged", async () => {
    const a = await makeOrder(csm);
    const b = await makeOrder(csm);
    const create = await as(csm).post(`/api/orders/${a.order.id}/change-requests`).send({ kind: "COMBINE_ORDERS", other_order_id: b.order.id, reason: "Same visit" });
    expect(create.status).toBe(201);
    const ok = await as(admin).post(`/api/change-requests/${create.body.request.id}/approve`).send({});
    expect(ok.status).toBe(200);
    const stores = await prisma.orderStore.findMany({ where: { order_id: a.order.id }, orderBy: { s_no: "asc" } });
    expect(stores.map((s) => s.s_no)).toEqual([1, 2]);
    expect(await prisma.orderItem.count({ where: { order_id: a.order.id } })).toBe(2);
    const closed = await prisma.order.findUniqueOrThrow({ where: { id: b.order.id } });
    expect(closed.status).toBe("Completed");
    expect(closed.merged_into_no).toBe(a.order.order_no);
  });

  it("refuses orders of different clients", async () => {
    const a = await makeOrder(csm);
    const b = await makeOrder(csm);
    await prisma.order.update({ where: { id: b.order.id }, data: { client_name: "Someone else" } });
    const res = await as(csm).post(`/api/orders/${a.order.id}/change-requests`).send({ kind: "COMBINE_ORDERS", other_order_id: b.order.id, reason: "Same visit" });
    expect(res.status).toBe(409);
  });
});

describe("field jobs: asks and send-back", () => {
  const makeJob = async () => {
    const paster = await makeUser("PASTER");
    const { order } = await makeOrder(csm);
    const res = await as(om).post("/api/work-jobs").send({ start_date: nextDay(), csm_user_id: csm.id, member_ids: [paster.id], order_id: order.id });
    expect(res.status).toBe(201);
    return { job: res.body, paster };
  };

  it("puts a rejected job on hold for the OM, with the reason", async () => {
    const { job, paster } = await makeJob();
    expect((await as(paster).put(`/api/my/work-jobs/${job.id}/status`).send({ status: "REJECTED" })).status).toBe(400);
    const res = await as(paster).put(`/api/my/work-jobs/${job.id}/status`).send({ status: "REJECTED", note: "Wrong address given" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("HOLD");
    expect(res.body.field_flag).toBe("REJECTED");
    expect(res.body.field_flag_reason).toBe("Wrong address given");
    const decided = await as(om).put(`/api/work-jobs/${job.id}/status`).send({ status: "ASSIGNED" });
    expect(decided.status).toBe(200);
    expect(decided.body.field_flag).toBeNull();
  });

  it("lets the job's CSM send the team back to a completed job", async () => {
    const { job } = await makeJob();
    expect((await as(csm).post(`/api/csm-jobs/${job.id}/send-back`).send({ reason: "Poster peeling" })).status).toBe(400);
    await as(om).put(`/api/work-jobs/${job.id}/status`).send({ status: "STARTED" });
    await as(om).put(`/api/work-jobs/${job.id}/status`).send({ status: "COMPLETED" });
    expect((await as(otherCsm).post(`/api/csm-jobs/${job.id}/send-back`).send({ reason: "Poster peeling" })).status).toBe(403);
    const day = nextDay();
    const res = await as(csm).post(`/api/csm-jobs/${job.id}/send-back`).send({ reason: "Poster peeling", date: day });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ASSIGNED");
    expect(res.body.start_date).toBe(day);
    expect(res.body.sent_back_count).toBe(1);
    expect(res.body.sent_back_reason).toBe("Poster peeling");
  });
});
