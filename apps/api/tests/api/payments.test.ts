import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, makeOrder, makeUser, onlyActiveCcm, prisma, uniq } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let ccm: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  ccm = await makeUser("COST_CONTROL_MANAGER");
  csm = await makeUser("CSM");
});

beforeEach(async () => {
  await prisma.user.update({ where: { id: ccm.id }, data: { is_active: true } });
  await onlyActiveCcm(ccm);
});

const UPI = { upi_method: "UPI_ID", upi_id: "test@okaxis", purpose: "Travel to the site" };

async function raise(opts: { amount?: number; bill?: boolean } = {}) {
  const { order } = await makeOrder(csm);
  const res = await as(csm)
    .post("/api/payment-requests")
    .send({ ...UPI, order_id: order.id, amount: opts.amount ?? 500, bill_details_required: !!opts.bill, idempotency_key: uniq("idem-key-") });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.request.id as number, orderId: order.id };
}

const statusOf = async (id: number) => (await prisma.paymentRequest.findUniqueOrThrow({ where: { id } })).status;

const addFile = (requestId: number, orderId: number, by: number) =>
  prisma.paymentAttachment.create({
    data: { request_id: requestId, order_id: orderId, kind: "BILL", original_name: "bill.pdf", mime: "application/pdf", size_bytes: 100, sha256: uniq("sha"), uploaded_by: by },
  });

/** A no-bill request taken through both approvals. */
async function pendingPayment() {
  const r = await raise();
  expect((await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({})).status).toBe(200);
  expect((await as(ccm).post(`/api/payment-requests/${r.id}/approve`).send({})).status).toBe(200);
  expect(await statusOf(r.id)).toBe("PAYMENT_PENDING");
  return r;
}

describe("bill requests (GAP-D01) and the Admin threshold (D-07)", () => {
  it("go straight to Cost Control, which needs the bill before approving", async () => {
    const r = await raise({ bill: true });
    expect(await statusOf(r.id)).toBe("CCM_REVIEW");

    const held = await as(ccm).post(`/api/payment-requests/${r.id}/approve`).send({});
    expect(held.status).toBe(409);
    expect(held.body.message).toMatch(/Attach the bill/);

    await addFile(r.id, r.orderId, csm.id);
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/approve`).send({})).status).toBe(200);
    expect(await statusOf(r.id)).toBe("PAYMENT_PENDING");
  });

  it("start with the Admin above the threshold, bill or not", async () => {
    const r = await raise({ bill: true, amount: 15_000 });
    expect(await statusOf(r.id)).toBe("ADMIN_REVIEW");
  });
});

describe("resubmitting a returned request (GAP-D02)", () => {
  async function returnedByCcm() {
    const r = await raise();
    await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({});
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/return`).send({ note: "Which store?" })).status).toBe(200);
    expect(await statusOf(r.id)).toBe("INFO_REQUESTED");
    return r;
  }

  it("goes back to Cost Control when the change is minor", async () => {
    const r = await returnedByCcm();
    const res = await as(csm).post(`/api/payment-requests/${r.id}/resubmit`).send({ ...UPI, amount: 450, note: "Store 2" });
    expect(res.status).toBe(200);
    expect(await statusOf(r.id)).toBe("CCM_REVIEW");
  });

  it("starts review again when it asks for more", async () => {
    const r = await returnedByCcm();
    const res = await as(csm).post(`/api/payment-requests/${r.id}/resubmit`).send({ ...UPI, amount: 700 });
    expect(res.status).toBe(200);
    expect(await statusOf(r.id)).toBe("ADMIN_REVIEW");
  });

  it("starts review again for a new payee", async () => {
    const r = await returnedByCcm();
    await as(csm).post(`/api/payment-requests/${r.id}/resubmit`).send({ ...UPI, amount: 500, upi_id: "other@okaxis" });
    expect(await statusOf(r.id)).toBe("ADMIN_REVIEW");
  });
});

describe("once approved for payment (GAP-C07, GAP-D04)", () => {
  it("only Cost Control rejects, with a reason, and nobody cancels", async () => {
    const r = await pendingPayment();
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/cancel`).send({ note: "Duplicate" })).status).toBe(409);
    expect((await as(admin).post(`/api/payment-requests/${r.id}/reject`).send({ note: "Duplicate" })).status).toBe(403);
    expect((await as(csm).post(`/api/payment-requests/${r.id}/reject`).send({ note: "Duplicate" })).status).toBe(403);
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/reject`).send({})).status).toBe(400);
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/reject`).send({ note: "Duplicate" })).status).toBe(200);
    expect(await statusOf(r.id)).toBe("REJECTED");
  });

  it("marks paid without a UTR, and cannot be rejected after that", async () => {
    const r = await pendingPayment();
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/mark-paid`).send({ payment_reference: "12" })).status).toBe(400);
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/mark-paid`).send({ payment_reference: " " })).status).toBe(200);
    const row = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("PAID");
    expect(row.payment_reference).toBeNull();
    expect((await as(ccm).post(`/api/payment-requests/${r.id}/reject`).send({ note: "Too late" })).status).toBe(409);
  });

  it("paying less than asked needs a note", async () => {
    const r = await pendingPayment();
    const short = await as(ccm).post(`/api/payment-requests/${r.id}/mark-paid`).send({ paid_amount: 400, payment_reference: "UTR123456" });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/less than asked/);

    const ok = await as(ccm)
      .post(`/api/payment-requests/${r.id}/mark-paid`)
      .send({ paid_amount: 400, payment_reference: "UTR123456", note: "₹100 advance already given" });
    expect(ok.status).toBe(200);
    const row = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("PAID");
    expect(Number(row.paid_amount)).toBe(400);
  });
});

describe("with no active Cost Control Manager (D-05)", () => {
  it("the Admin approves, pays and closes in Cost Control's place", async () => {
    await onlyActiveCcm(null);
    const r = await raise();
    expect((await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({})).status).toBe(200);
    expect(await statusOf(r.id)).toBe("CCM_REVIEW");
    expect((await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({})).status).toBe(200);
    expect((await as(admin).post(`/api/payment-requests/${r.id}/mark-paid`).send({ payment_reference: "UTR999999" })).status).toBe(200);
    expect((await as(admin).post(`/api/payment-requests/${r.id}/close`).send({})).status).toBe(200);
    expect(await statusOf(r.id)).toBe("CLOSED");
  });

  it("the Admin cannot while one is active", async () => {
    const r = await raise();
    await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({});
    expect((await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({})).status).toBe(403);
  });
});

describe("files (GAP-F04)", () => {
  it("the requester may remove their own file only until the first approval", async () => {
    const r = await raise();
    const early = await addFile(r.id, r.orderId, csm.id);
    expect((await as(csm).delete(`/api/payment-requests/${r.id}/attachments/${early.id}`)).status).toBe(200);

    const late = await addFile(r.id, r.orderId, csm.id);
    await as(admin).post(`/api/payment-requests/${r.id}/approve`).send({});
    const frozen = await as(csm).delete(`/api/payment-requests/${r.id}/attachments/${late.id}`);
    expect(frozen.status).toBe(403);
    expect(frozen.body.message).toMatch(/files stay/);
  });

  it("a reviewer removing someone else's file says why", async () => {
    const r = await raise();
    const f = await addFile(r.id, r.orderId, csm.id);
    expect((await as(admin).delete(`/api/payment-requests/${r.id}/attachments/${f.id}`)).status).toBe(400);
    expect((await as(admin).delete(`/api/payment-requests/${r.id}/attachments/${f.id}`).send({ note: "Wrong order's bill" })).status).toBe(200);
  });
});
