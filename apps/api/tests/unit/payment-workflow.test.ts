import { describe, expect, it } from "vitest";
import {
  availableActions,
  blockedActions,
  checkTransition,
  entryStage,
  isMaterialChange,
  paymentEligibility,
  routeFor,
  type WorkflowRequest,
} from "../../src/utils/payment-workflow";

const REQUESTER = { id: 10, role: "CSM" };
const OTHER_CSM = { id: 11, role: "CSM" };
const ADMIN = { id: 1, role: "ADMIN" };
const CCM = { id: 2, role: "COST_CONTROL_MANAGER" };

const req = (over: Partial<WorkflowRequest> = {}): WorkflowRequest => ({
  status: "ADMIN_REVIEW",
  route: "ADMIN_THEN_CCM",
  requested_by: REQUESTER.id,
  returned_from: null,
  bill_details_required: false,
  ...over,
});

describe("routes and entry stage", () => {
  it("routes by the bill choice", () => {
    expect(routeFor(true)).toBe("CCM_ONLY");
    expect(routeFor(false)).toBe("ADMIN_THEN_CCM");
  });

  it("starts at the route's first stage at or below the threshold", () => {
    expect(entryStage("CCM_ONLY", 10_000, 10_000)).toBe("CCM_REVIEW");
    expect(entryStage("ADMIN_THEN_CCM", 500, 10_000)).toBe("ADMIN_REVIEW");
  });

  it("sends anything above the threshold to the Admin first, bill or not (D-07)", () => {
    expect(entryStage("CCM_ONLY", 10_000.01, 10_000)).toBe("ADMIN_REVIEW");
    expect(entryStage("CCM_ONLY", 50_000, 10_000)).toBe("ADMIN_REVIEW");
  });
});

describe("approve", () => {
  it("lets each stage's reviewer approve, and only them", () => {
    expect(checkTransition(req(), "APPROVE", ADMIN)).toEqual({ ok: true, to: "CCM_REVIEW" });
    expect(checkTransition(req(), "APPROVE", CCM)).toMatchObject({ ok: false, status: 403 });
    const atCcm = req({ status: "CCM_REVIEW" });
    expect(checkTransition(atCcm, "APPROVE", CCM)).toEqual({ ok: true, to: "PAYMENT_PENDING" });
    expect(checkTransition(atCcm, "APPROVE", ADMIN)).toMatchObject({ ok: false, status: 403 });
    expect(checkTransition(atCcm, "APPROVE", REQUESTER)).toMatchObject({ ok: false, status: 403 });
  });

  it("holds a bill-route approval until a bill is attached (GAP-D01)", () => {
    const r = req({ status: "CCM_REVIEW", route: "CCM_ONLY", bill_details_required: true });
    expect(checkTransition(r, "APPROVE", CCM, null, { billCount: 0 })).toMatchObject({ ok: false, status: 409 });
    expect(blockedActions(r, CCM, { billCount: 0 }).APPROVE).toMatch(/Attach the bill/);
    expect(checkTransition(r, "APPROVE", CCM, null, { billCount: 1 })).toEqual({ ok: true, to: "PAYMENT_PENDING" });
    expect(blockedActions(r, CCM, { billCount: 1 })).toEqual({});
  });

  it("lets the Admin act for Cost Control only while no CCM is active (D-05)", () => {
    const r = req({ status: "CCM_REVIEW" });
    expect(checkTransition(r, "APPROVE", ADMIN, null, { noActiveCcm: true })).toEqual({ ok: true, to: "PAYMENT_PENDING" });
    expect(checkTransition(r, "APPROVE", ADMIN, null, { noActiveCcm: false })).toMatchObject({ ok: false, status: 403 });
    const pending = req({ status: "PAYMENT_PENDING" });
    expect(availableActions(pending, ADMIN, { noActiveCcm: true })).toEqual(expect.arrayContaining(["MARK_PAID", "CANCEL"]));
    expect(availableActions(pending, ADMIN)).toEqual([]);
  });
});

describe("reject and return", () => {
  it("needs a reason", () => {
    expect(checkTransition(req(), "REJECT", ADMIN, "")).toMatchObject({ ok: false, status: 400 });
    expect(checkTransition(req(), "RETURN", ADMIN, " ")).toMatchObject({ ok: false, status: 400 });
    expect(checkTransition(req(), "RETURN", ADMIN, "Which store?")).toEqual({ ok: true, to: "INFO_REQUESTED" });
  });

  it("refuses from a closed status with 409", () => {
    expect(checkTransition(req({ status: "PAID" }), "REJECT", ADMIN, "no")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("resubmit", () => {
  const returned = req({ status: "INFO_REQUESTED", returned_from: "CCM_REVIEW" });

  it("is the requester's alone", () => {
    expect(checkTransition(returned, "RESUBMIT", OTHER_CSM)).toMatchObject({ ok: false, status: 403 });
  });

  it("goes back to whoever returned it when nothing material changed", () => {
    expect(checkTransition(returned, "RESUBMIT", REQUESTER)).toEqual({ ok: true, to: "CCM_REVIEW" });
  });

  it("starts review again after a material change (GAP-D02)", () => {
    expect(checkTransition(returned, "RESUBMIT", REQUESTER, null, { materialChange: true, entryStage: "ADMIN_REVIEW" })).toEqual({
      ok: true,
      to: "ADMIN_REVIEW",
    });
    expect(checkTransition(returned, "RESUBMIT", REQUESTER, null, { materialChange: true })).toEqual({ ok: true, to: "ADMIN_REVIEW" });
  });

  it("calls more money or a new payee material, and nothing else", () => {
    const base = { amount: 1000, upi_method: "UPI_ID", upi_id: "a@okicici" };
    expect(isMaterialChange(base, { ...base, amount: 1200 })).toBe(true);
    expect(isMaterialChange(base, { ...base, upi_id: "b@okicici" })).toBe(true);
    expect(isMaterialChange(base, { ...base, upi_method: "MOBILE" })).toBe(true);
    expect(isMaterialChange(base, { ...base, amount: 800 })).toBe(false);
    expect(isMaterialChange(base, { ...base })).toBe(false);
  });
});

describe("cancel", () => {
  it("lets the requester withdraw before approval without a reason", () => {
    expect(checkTransition(req(), "CANCEL", REQUESTER)).toEqual({ ok: true, to: "CANCELLED" });
  });

  it("stops the requester once anyone has approved", () => {
    const afterAdmin = req({ status: "CCM_REVIEW" });
    expect(checkTransition(afterAdmin, "CANCEL", REQUESTER)).toMatchObject({ ok: false, status: 403 });
    // Bill route straight to Cost Control: nobody has approved yet.
    const billRoute = req({ status: "CCM_REVIEW", route: "CCM_ONLY" });
    expect(checkTransition(billRoute, "CANCEL", REQUESTER)).toEqual({ ok: true, to: "CANCELLED" });
    // Over-threshold bill request the Admin approved: the history says so.
    expect(checkTransition(billRoute, "CANCEL", REQUESTER, null, { adminApproved: true })).toMatchObject({ ok: false, status: 403 });
  });

  it("asks the Admin for a reason during review", () => {
    expect(checkTransition(req(), "CANCEL", ADMIN)).toMatchObject({ ok: false, status: 400 });
    expect(checkTransition(req(), "CANCEL", ADMIN, "Duplicate")).toEqual({ ok: true, to: "CANCELLED" });
  });

  it("leaves a payment-pending request to Cost Control only (GAP-C07)", () => {
    const pending = req({ status: "PAYMENT_PENDING" });
    expect(checkTransition(pending, "CANCEL", ADMIN, "Duplicate")).toMatchObject({ ok: false, status: 403 });
    expect(checkTransition(pending, "CANCEL", REQUESTER)).toMatchObject({ ok: false, status: 403 });
    expect(checkTransition(pending, "CANCEL", CCM, "Duplicate")).toEqual({ ok: true, to: "CANCELLED" });
    expect(checkTransition(pending, "CANCEL", CCM)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("paid and close", () => {
  it("marks paid and closes as Cost Control", () => {
    expect(checkTransition(req({ status: "PAYMENT_PENDING" }), "MARK_PAID", CCM)).toEqual({ ok: true, to: "PAID" });
    expect(checkTransition(req({ status: "PAID" }), "CLOSE", CCM)).toEqual({ ok: true, to: "CLOSED" });
    expect(checkTransition(req({ status: "PAID" }), "CLOSE", ADMIN)).toMatchObject({ ok: false, status: 403 });
  });

  it("won't close a bill request without its bill", () => {
    const r = req({ status: "PAID", bill_details_required: true });
    expect(checkTransition(r, "CLOSE", CCM, null, { billCount: 0 })).toMatchObject({ ok: false, status: 409 });
    expect(checkTransition(r, "CLOSE", CCM, null, { billCount: 2 })).toEqual({ ok: true, to: "CLOSED" });
  });
});

describe("paymentEligibility", () => {
  it("opens with nothing in production", () => {
    expect(paymentEligibility({ status: "Active", items: [{}] }).eligible).toBe(true);
  });

  it("waits for production to finish", () => {
    const order = { status: "Active" as const, items: [{ assignments: [1], production_completed: true }, { assignments: [1], production_completed: false }] };
    expect(paymentEligibility(order)).toMatchObject({ eligible: false });
    order.items[1].production_completed = true;
    expect(paymentEligibility(order).eligible).toBe(true);
  });

  it("closes once any store is invoiced", () => {
    expect(paymentEligibility({ status: "Installed", items: [], stores: [{ invoice_id: 3 }] }).eligible).toBe(false);
  });
});
