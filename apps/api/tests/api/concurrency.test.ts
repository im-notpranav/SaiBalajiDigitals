import { beforeAll, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, prisma, uniq } from "./helpers";

/**
 * Two people acting on the same record at once: exactly one wins, and the other is told
 * so instead of silently overwriting it (GAP-E01, GAP-E02).
 */

let admin: Awaited<ReturnType<typeof makeUser>>;
let om: Awaited<ReturnType<typeof makeUser>>;
let accounts: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  om = await makeUser("OPERATION_MANAGER");
  accounts = await makeUser("ACCOUNTS");
  csm = await makeUser("CSM");
});

const codes = (rs: { status: number }[]) => rs.map((r) => r.status).sort();

describe("leave decided by two managers at once", () => {
  it("takes the first decision only", async () => {
    const paster = await makeUser("PASTER");
    const day = new Date(Date.UTC(2031, 0, 10));
    const leave = await prisma.leaveRecord.create({
      data: { user_id: paster.id, from_date: day, to_date: day, reason: "Family function", status: "PENDING", created_by: paster.id },
    });
    const rs = await Promise.all([
      as(om).put(`/api/leave/${leave.id}/decision`).send({ status: "APPROVED" }),
      as(admin).put(`/api/leave/${leave.id}/decision`).send({ status: "REJECTED", reason: "Short-staffed" }),
    ]);
    expect(codes(rs)).toEqual([200, 400]);
    const loser = rs.find((r) => r.status === 400)!;
    expect(loser.body.message).toMatch(/already been/);
  });
});

describe("a job completed and cancelled at once", () => {
  it("ends up one or the other, never both", async () => {
    const { order } = await makeOrder(csm);
    const area = await prisma.area.create({ data: { name: uniq("Area "), locality: "LOCAL" } });
    const day = new Date(Date.UTC(2031, 1, 1));
    const job = await prisma.workJob.create({
      data: { order_id: order.id, start_date: day, end_date: day, work_details: "Flex fixing", area_id: area.id, locality: "LOCAL", status: "STARTED" },
    });
    const rs = await Promise.all([
      as(om).put(`/api/work-jobs/${job.id}/status`).send({ status: "COMPLETED" }),
      as(admin).put(`/api/work-jobs/${job.id}/status`).send({ status: "CANCELLED", reason: "Client called off" }),
    ]);
    expect(codes(rs)).toEqual([200, 400]);
    const saved = await prisma.workJob.findUniqueOrThrow({ where: { id: job.id } });
    const winner = rs.find((r) => r.status === 200)!;
    expect(saved.status).toBe(winner.body.status);
    // A cancelled job carries no completion, and a completed one no cancellation.
    expect(saved.status === "CANCELLED" ? saved.completed_at : saved.cancelled_at).toBeNull();
  });
});

describe("invoices", () => {
  it("puts a store on one invoice only when two are raised at once", async () => {
    const { order, store } = await makeOrder(csm, { installed: true });
    const body = (no: string) => ({ invoice_no: no, bill_amount: 1000, billing_date: new Date().toISOString(), store_ids: [store.id] });
    const rs = await Promise.all([
      as(accounts).post(`/api/orders/${order.id}/invoices`).send(body(uniq("A"))),
      as(accounts).post(`/api/orders/${order.id}/invoices`).send(body(uniq("B"))),
    ]);
    expect(rs.filter((r) => r.status < 300)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await prisma.invoice.count({ where: { order_id: order.id } })).toBe(1);
  });

  it("records a payment once when two people record it at once", async () => {
    const { order, store } = await makeOrder(csm, { installed: true });
    const inv = await prisma.invoice.create({ data: { order_id: order.id, invoice_no: uniq("P"), bill_amount: 1000, billing_date: new Date() } });
    await prisma.orderStore.update({ where: { id: store.id }, data: { invoice_id: inv.id } });

    const pay = (amount: number) =>
      as(accounts).put(`/api/orders/${order.id}/invoices/${inv.id}/payment`).send({ amount_received: amount, payment_date: new Date().toISOString() });
    const rs = await Promise.all([pay(1000), pay(600)]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 400 || r.status === 409)).toHaveLength(1);

    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    const winner = rs.find((r) => r.status === 200)!;
    expect(Number(saved.amount_received)).toBe(Number(winner.body.amount_received));
  });
});
