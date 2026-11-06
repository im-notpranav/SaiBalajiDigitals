import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, prisma, uniq } from "./helpers";

/** Dates far ahead, one per test, so jobs here never overlap anything else in the test database. */
let dayNo = 0;
const nextDay = () => {
  dayNo += 1;
  return `2033-03-${String(dayNo).padStart(2, "0")}`;
};
const idOf = (p: { id: number }) => p.id;

let om: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;
let otherCsm: Awaited<ReturnType<typeof makeUser>>;
let paster: Awaited<ReturnType<typeof makeUser>>;
let helper: Awaited<ReturnType<typeof makeUser>>;
let driver: Awaited<ReturnType<typeof makeUser>>;
let day: string;

beforeAll(async () => {
  om = await makeUser("OPERATION_MANAGER");
  csm = await makeUser("CSM");
  otherCsm = await makeUser("CSM");
});

beforeEach(async () => {
  paster = await makeUser("PASTER");
  helper = await makeUser("HELPER");
  driver = await makeUser("DRIVER");
  day = nextDay();
});

const body = (over: Record<string, unknown> = {}) => ({
  start_date: day,
  csm_user_id: csm.id,
  member_ids: [paster.id, driver.id],
  ...over,
});
const assign = (over: Record<string, unknown> = {}) => as(om).post("/api/work-jobs").send(body(over));

describe("assigning a job", () => {
  it("needs only dates, a CSM, a Paster and a Driver", async () => {
    const res = await assign();
    expect(res.status).toBe(201);
    expect(res.body.order).toBeNull();
    expect(res.body.area).toBeNull();
    expect(res.body.locality).toBeNull();
    expect(res.body.work_details).toBeNull();
    expect(res.body.csm.id).toBe(csm.id);
  });

  it("refuses a job missing the CSM, the Paster or the Driver", async () => {
    expect((await assign({ csm_user_id: null })).status).toBe(400);
    expect((await assign({ member_ids: [driver.id] })).status).toBe(400);
    expect((await assign({ member_ids: [paster.id] })).status).toBe(400);
  });

  it("takes the CSM from an order they raised when none is picked", async () => {
    const { order } = await makeOrder(otherCsm);
    const res = await assign({ csm_user_id: null, order_id: order.id });
    expect(res.status).toBe(201);
    expect(res.body.csm.id).toBe(otherCsm.id);
  });

  it("allows a Helper, and no Helper", async () => {
    const res = await assign({ member_ids: [paster.id, helper.id, driver.id] });
    expect(res.status).toBe(201);
    expect(res.body.members).toHaveLength(3);
  });

  it("adds a new area name to the list once, whatever its case", async () => {
    const name = uniq("Kurnool ");
    const first = await assign({ locality: "NON_LOCAL", area_name: name });
    expect(first.status).toBe(201);
    expect(first.body.area.name).toBe(name);
    expect(first.body.locality).toBe("NON_LOCAL");

    day = nextDay();
    const second = await assign({ locality: "NON_LOCAL", area_name: name.toLowerCase() });
    expect(second.status).toBe(201);
    expect(second.body.area.id).toBe(first.body.area.id);
    const row = await prisma.area.findUniqueOrThrow({ where: { id: first.body.area.id } });
    expect(row.locality).toBe("NON_LOCAL");
  });

  it("refuses an area name with no location", async () => {
    expect((await assign({ area_name: "Kurnool" })).status).toBe(400);
  });

  it("books someone busy only when told to", async () => {
    expect((await assign()).status).toBe(201);
    const refused = await assign();
    expect(refused.status).toBe(409);
    expect(refused.body.conflicts).toHaveLength(2);
    expect((await assign({ allow_double_booking: true })).status).toBe(201);
  });

  it("never books someone on approved leave", async () => {
    const date = new Date(`${day}T00:00:00Z`);
    await prisma.leaveRecord.create({ data: { user_id: paster.id, from_date: date, to_date: date, status: "APPROVED" } });
    const res = await assign({ allow_double_booking: true });
    expect(res.status).toBe(409);
    expect(res.body.leave_conflicts).toHaveLength(1);
  });

  it("lets the Operation Manager link an order later", async () => {
    const job = await assign();
    const { order, store } = await makeOrder(csm);
    const res = await as(om).put(`/api/work-jobs/${job.body.id}`).send(body({ order_id: order.id, store_ids: [store.id] }));
    expect(res.status).toBe(200);
    expect(res.body.order.order_no).toBe(order.order_no);
    expect(res.body.stores.map(idOf)).toEqual([store.id]);
  });

  it("keeps a job with payment requests on its order", async () => {
    const { order } = await makeOrder(csm);
    const { body: job } = await assign({ order_id: order.id });
    const raised = await as(csm).post("/api/payment-requests").send({
      upi_method: "UPI_ID",
      upi_id: "test@okaxis",
      purpose: "Travel to the site",
      order_id: order.id,
      work_job_id: job.id,
      amount: 500,
      bill_details_required: false,
      idempotency_key: uniq("idem-key-"),
    });
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);

    const { order: next } = await makeOrder(csm);
    const moved = await as(om).put(`/api/work-jobs/${job.id}`).send(body({ order_id: next.id }));
    expect(moved.status).toBe(400);
    expect(moved.body.message).toMatch(/payment requests/);
    expect((await as(csm).patch(`/api/csm-jobs/${job.id}`).send({ order_id: next.id })).status).toBe(400);
    expect((await as(om).put(`/api/work-jobs/${job.id}`).send(body({ order_id: order.id, work_details: "Same order" }))).status).toBe(200);
  });

  it("refuses stores on a job with no order", async () => {
    const { store } = await makeOrder(csm);
    expect((await assign({ store_ids: [store.id] })).status).toBe(400);
  });
});

describe("the Operation Manager's overview", () => {
  it("counts jobs by location and lists who is free", async () => {
    const area = uniq("Ameerpet ");
    await assign({ locality: "LOCAL", area_name: area });
    const free = await makeUser("PASTER");

    const res = await as(om).get(`/api/work-jobs/overview?from=${day}&to=${day}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toMatchObject({ total: 1, LOCAL: 1, NON_LOCAL: 0, NOT_SET: 0 });
    expect(res.body.free.PASTER.map(idOf)).toContain(free.id);
    expect(res.body.free.PASTER.map(idOf)).not.toContain(paster.id);
    expect(res.body.free.HELPER.map(idOf)).toContain(helper.id);
    expect(res.body.areas).toEqual([area]);
  });

  it("filters jobs by area, but anyone on any job stays busy", async () => {
    await assign({ locality: "LOCAL", area_name: uniq("Ameerpet ") });
    const res = await as(om).get(`/api/work-jobs/overview?from=${day}&to=${day}&area=${uniq("Nowhere")}`);
    expect(res.body.jobs.LOCAL).toBe(0);
    expect(res.body.free.PASTER.map(idOf)).not.toContain(paster.id);
  });

  it("counts someone free only when free on every day of the range", async () => {
    const start = nextDay();
    const end = nextDay();
    await assign({ start_date: end });
    const res = await as(om).get(`/api/work-jobs/overview?from=${start}&to=${end}`);
    expect(res.body.free.PASTER.map(idOf)).not.toContain(paster.id);
  });

  it("counts a job with no location, and lists it", async () => {
    const job = await assign();
    const res = await as(om).get(`/api/work-jobs/overview?from=${day}&to=${day}`);
    expect(res.body.jobs.NOT_SET).toBe(1);
    const list = await as(om).get(`/api/work-jobs?from=${day}&to=${day}&locality=NOT_SET`);
    expect(list.body.jobs.map(idOf)).toEqual([job.body.id]);
  });

  it("leaves out cancelled jobs", async () => {
    const job = await assign();
    await as(om).put(`/api/work-jobs/${job.body.id}/status`).send({ status: "CANCELLED", reason: "Postponed" });
    const res = await as(om).get(`/api/work-jobs/overview?from=${day}&to=${day}`);
    expect(res.body.jobs.total).toBe(0);
    expect(res.body.free.PASTER.map(idOf)).toContain(paster.id);
  });
});

describe("the grid", () => {
  it("gives each job's box its order, CSM and team", async () => {
    const job = await assign({ member_ids: [paster.id, helper.id, driver.id] });
    const res = await as(om).get(`/api/work-jobs/grid?from=${day}&days=1`);
    expect(res.status).toBe(200);
    expect(res.body.jobs[job.body.id]).toEqual({
      order_no: null,
      csm: csm.name,
      pasters: [paster.name],
      helpers: [helper.name],
      drivers: [driver.name],
    });
  });

  it("opens a job's order details without rates or amounts", async () => {
    const { order } = await makeOrder(csm);
    const job = await assign({ order_id: order.id });
    const res = await as(om).get(`/api/work-jobs/${job.body.id}/details`);
    expect(res.status).toBe(200);
    const item = res.body.order_stores[0].items[0];
    expect(item).toMatchObject({ media: "Flex", width_inches: 120, height_inches: 120, qty: 1, total_sft: 100 });
    expect(JSON.stringify(res.body)).not.toMatch(/"rate"|"amount"/);
  });
});

describe("the CSM's own jobs", () => {
  it("shows a job only to its CSM", async () => {
    const job = await assign();
    expect((await as(csm).get("/api/csm-jobs")).body.jobs.map(idOf)).toContain(job.body.id);
    expect((await as(otherCsm).get("/api/csm-jobs")).body.jobs.map(idOf)).not.toContain(job.body.id);
  });

  it("lets only that CSM change it", async () => {
    const { body: job } = await assign();
    expect((await as(otherCsm).patch(`/api/csm-jobs/${job.id}`).send({ work_details: "Not mine" })).status).toBe(404);
    expect((await as(om).patch(`/api/csm-jobs/${job.id}`).send({ work_details: "Not mine" })).status).toBe(403);

    const res = await as(csm).patch(`/api/csm-jobs/${job.id}`).send({ work_details: "Fix the flex" });
    expect(res.status).toBe(200);
    expect(res.body.work_details).toBe("Fix the flex");
  });

  it("links only the CSM's own order, and drops stores from the old one", async () => {
    const { order: first, store } = await makeOrder(csm);
    const { body: job } = await assign({ order_id: first.id, store_ids: [store.id] });

    const { order: theirs } = await makeOrder(otherCsm);
    expect((await as(csm).patch(`/api/csm-jobs/${job.id}`).send({ order_id: theirs.id })).status).toBe(400);

    const { order: own } = await makeOrder(csm);
    const res = await as(csm).patch(`/api/csm-jobs/${job.id}`).send({ order_id: own.id });
    expect(res.status).toBe(200);
    expect(res.body.order.order_no).toBe(own.order_no);
    expect(res.body.stores).toEqual([]);
  });

  it("offers only the CSM's own orders", async () => {
    const { order: own } = await makeOrder(csm);
    const { order: theirs } = await makeOrder(otherCsm);
    const ids = (await as(csm).get("/api/csm-jobs/order-options")).body.orders.map(idOf);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("does not let a completed job change", async () => {
    const { body: job } = await assign();
    await as(om).put(`/api/work-jobs/${job.id}/status`).send({ status: "STARTED" });
    await as(om).put(`/api/work-jobs/${job.id}/status`).send({ status: "COMPLETED" });
    expect((await as(csm).patch(`/api/csm-jobs/${job.id}`).send({ work_details: "Late" })).status).toBe(400);
  });
});
