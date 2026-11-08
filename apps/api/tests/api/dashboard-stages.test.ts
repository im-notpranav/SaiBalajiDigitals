import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, onlyActiveCcm, prisma, uniq } from "./helpers";

let csm: Awaited<ReturnType<typeof makeUser>>;
let production: Awaited<ReturnType<typeof makeUser>>;
let ccm: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  csm = await makeUser("CSM");
  production = await makeUser("PRODUCTION");
  ccm = await makeUser("COST_CONTROL_MANAGER");
});

const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

describe("the order pipeline on GET /api/dashboard/csm", () => {
  it("shows an order nobody has been given work on as Not assigned, then Production once someone has", async () => {
    const { order } = await makeOrder(csm);

    const before = await as(csm).get("/api/dashboard/csm");
    expect(before.status).toBe(200);
    expect(ids(before.body.stage_orders.unassigned)).toContain(order.id);
    expect(ids(before.body.stage_orders.production)).not.toContain(order.id);
    expect(before.body.stages.unassigned.count).toBe(before.body.stage_orders.unassigned.length);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { order_id: order.id } });
    await prisma.orderItemAssignment.create({
      data: { order_item_id: item.id, user_id: production.id },
    });

    const after = await as(csm).get("/api/dashboard/csm");
    expect(ids(after.body.stage_orders.unassigned)).not.toContain(order.id);
    expect(ids(after.body.stage_orders.production)).toContain(order.id);
  });
});

describe("GET /api/payment-requests?paid=month", () => {
  async function paidRequest(paidAt: Date) {
    const { order } = await makeOrder(csm);
    const res = await as(csm)
      .post("/api/payment-requests")
      .send({
        upi_method: "UPI_ID",
        upi_id: "test@okaxis",
        purpose: "Travel to the site",
        order_id: order.id,
        amount: 300,
        bill_details_required: false,
        idempotency_key: uniq("idem-key-"),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.request.id as number;
    await prisma.paymentRequest.update({
      where: { id },
      data: { status: "PAID", paid_at: paidAt, paid_amount: 300 },
    });
    return id;
  }

  it("lists only what was paid out since the start of this month, as the dashboard counts it", async () => {
    await onlyActiveCcm(ccm);
    const thisMonth = await paidRequest(new Date());
    const earlier = await paidRequest(new Date(Date.now() - 45 * 86_400_000));

    const res = await as(ccm).get("/api/payment-requests?paid=month");
    expect(res.status).toBe(200);
    const listed = ids(res.body.requests);
    expect(listed).toContain(thisMonth);
    expect(listed).not.toContain(earlier);

    const dash = await as(ccm).get("/api/payment-requests/dashboard");
    expect(dash.status).toBe(200);
    expect(res.body.requests.length).toBe(dash.body.money.paid_this_month.count);
  });
});
