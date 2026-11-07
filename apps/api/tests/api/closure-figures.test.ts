import { beforeAll, describe, expect, it } from "vitest";
import { CLOSED_STATUSES } from "../../src/utils/order-status";
import { closureFigures } from "../../src/utils/order-stage";
import { as, makeOrder, makeUser, prisma } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

/** The figures the orders in the shared test database should give right now. */
async function expectedFigures() {
  const closed = await prisma.order.findMany({
    where: { status: { in: CLOSED_STATUSES } },
    select: { status: true, created_at: true, updated_at: true, invoices: true },
  });
  return { closedCount: closed.length, ...closureFigures(await prisma.order.count(), closed) };
}

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  csm = await makeUser("CSM");
});

describe("closure figures on GET /api/dashboard", () => {
  it("come from the orders, and move when an order closes", async () => {
    const { order } = await makeOrder(csm);
    const before = await expectedFigures();

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "Completed",
        created_at: new Date(2026, 10, 2, 12), // a Monday
        updated_at: new Date(2026, 10, 9, 12), // the next Monday, six working days on
      },
    });

    const after = await expectedFigures();
    expect(after.closedCount).toBe(before.closedCount + 1);

    const res = await as(admin).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.closure_rate).toBe(after.closure_rate);
    expect(res.body.avg_cycle_days).toBe(after.avg_cycle_days);
    expect(res.body.avg_cycle_days).toBeGreaterThan(0);
  });

  it("give the admin dashboard the same cycle time as Reports", async () => {
    const { order } = await makeOrder(csm);
    await prisma.order.update({ where: { id: order.id }, data: { status: "Completed" } });

    const reports = await as(admin).get("/api/dashboard");
    const dashboard = await as(admin).get("/api/dashboard/admin");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.avg_cycle_days).toBe(reports.body.avg_cycle_days);
    expect(dashboard.body.avg_cycle_days).toBe((await expectedFigures()).avg_cycle_days);
  });

  it("are not sent to a CSM, whose dashboard does not show them", async () => {
    const res = await as(csm).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.closure_rate).toBeUndefined();
    expect(res.body.avg_cycle_days).toBeUndefined();
  });
});
