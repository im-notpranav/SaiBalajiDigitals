import { apiFetch } from "./client";

/** Client for payment requests: money the company pays out to a requester by UPI. */

export type PaymentStatus =
  | "ADMIN_REVIEW"
  | "CCM_REVIEW"
  | "INFO_REQUESTED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "CLOSED"
  | "REJECTED"
  | "CANCELLED";
export type PaymentRoute = "ADMIN_THEN_CCM" | "CCM_ONLY";
export type PaymentCategory = "TRAVEL" | "MATERIAL" | "LABOUR" | "FOOD" | "ADVANCE" | "OTHER";
export type PaymentActionName =
  "APPROVE" | "REJECT" | "RETURN" | "RESUBMIT" | "CANCEL" | "MARK_PAID" | "CLOSE";

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  ADMIN_REVIEW: "Admin review",
  CCM_REVIEW: "Cost Control review",
  INFO_REQUESTED: "Returned for info",
  PAYMENT_PENDING: "Payment pending",
  PAID: "Paid",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const CATEGORY_LABELS: Record<PaymentCategory, string> = {
  TRAVEL: "Travel",
  MATERIAL: "Material",
  LABOUR: "Labour",
  FOOD: "Food",
  ADVANCE: "Advance",
  OTHER: "Other",
};

export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = [
  "ADMIN_REVIEW",
  "CCM_REVIEW",
  "INFO_REQUESTED",
  "PAYMENT_PENDING",
  "PAID",
];

export interface OrderMoney {
  order_value: number;
  requested: number;
  paid: number;
  requests: number;
  over_value: boolean;
}

export interface PaymentRequest {
  id: number;
  request_no: string;
  order: { id: number; order_no: string; client_name: string; status: string };
  work_job: { id: number; job_no: string; work_details: string } | null;
  requester: {
    id: number;
    name: string;
    role: string;
    phone: string | null;
    emp_code: string | null;
  };
  amount: number;
  upi_id: string;
  category: PaymentCategory | null;
  purpose: string;
  remarks: string | null;
  bill_details_required: boolean;
  route: PaymentRoute;
  status: PaymentStatus;
  returned_from: PaymentStatus | null;
  status_changed_at: string;
  paid_amount: number | null;
  paid_at: string | null;
  payment_reference: string | null;
  payer: { id: number; name: string } | null;
  closed_at: string | null;
  closer: { id: number; name: string } | null;
  created_at: string;
  is_mine: boolean;
  actions: PaymentActionName[];
  /** Reviewers only. */
  order_money?: OrderMoney;
}

export interface PaymentEvent {
  id: number;
  action: "SUBMIT" | PaymentActionName;
  from_status: PaymentStatus | null;
  to_status: PaymentStatus;
  actor: { id: number; name: string } | null;
  actor_role: string;
  note: string | null;
  created_at: string;
}

export interface PaymentOrderOption {
  id: number;
  order_no: string;
  client_name: string;
  status: string;
  eligibility: { eligible: boolean; reason: string };
  jobs: { id: number; job_no: string; work_details: string; start_date: string; status: string }[];
}

export interface PaymentList {
  requests: PaymentRequest[];
  counts: Record<PaymentStatus, number>;
  amounts: Record<PaymentStatus, number>;
  queue_statuses: PaymentStatus[];
}

export const fetchPaymentRequests = (
  params: { scope?: "queue"; status?: string; q?: string } = {},
) => apiFetch<PaymentList>("/payment-requests", { params });

export const fetchPaymentRequest = (id: number) =>
  apiFetch<{ request: PaymentRequest; events: PaymentEvent[] }>(`/payment-requests/${id}`);

export const fetchPaymentOrderOptions = (q: string) =>
  apiFetch<{ orders: PaymentOrderOption[] }>("/payment-requests/order-options", { params: { q } });

export interface PaymentRequestInput {
  amount: number;
  upi_id: string;
  category: PaymentCategory | null;
  purpose: string;
  remarks: string | null;
}

export const createPaymentRequest = (
  data: PaymentRequestInput & {
    order_id: number;
    work_job_id: number | null;
    bill_details_required: boolean;
    idempotency_key: string;
  },
) =>
  apiFetch<{ request: PaymentRequest; warning?: string | null; duplicate?: boolean }>(
    "/payment-requests",
    {
      method: "POST",
      data,
    },
  );

const ACTION_PATHS: Record<PaymentActionName, string> = {
  APPROVE: "approve",
  REJECT: "reject",
  RETURN: "return",
  RESUBMIT: "resubmit",
  CANCEL: "cancel",
  MARK_PAID: "mark-paid",
  CLOSE: "close",
};

export const paymentAction = (
  id: number,
  action: PaymentActionName,
  data: Record<string, unknown> = {},
) =>
  apiFetch<{ request: PaymentRequest }>(`/payment-requests/${id}/${ACTION_PATHS[action]}`, {
    method: "POST",
    data,
  });

export const formatRupees = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const formatWhen = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

/** Who acts next, in plain words, for a requester reading their own list. */
export function nextStepFor(r: Pick<PaymentRequest, "status" | "route">): string {
  switch (r.status) {
    case "ADMIN_REVIEW":
      return "Waiting for the Admin to approve";
    case "CCM_REVIEW":
      return "Waiting for Cost Control to approve";
    case "INFO_REQUESTED":
      return "Returned to you: correct it and resubmit";
    case "PAYMENT_PENDING":
      return "Approved, waiting to be paid";
    case "PAID":
      return "Paid, waiting to be closed";
    case "CLOSED":
      return "Done";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
  }
}

const ROLE_LABELS: Record<string, string> = {
  CSM: "CSM",
  PASTER: "Paster",
  HELPER: "Helper",
  DRIVER: "Driver",
};

/** A requester's role as people say it. */
export const roleLabel = (role: string) =>
  ROLE_LABELS[role] ?? role.replace(/_/g, " ").toLowerCase();
