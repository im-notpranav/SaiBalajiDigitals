import { apiClient, apiFetch } from "./client";

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

/** Where the money goes: a UPI ID (name@bank) or a UPI-linked mobile number. */
export type UpiMethod = "UPI_ID" | "MOBILE";

/** A request has no number of its own; it goes by its order's number. */
export interface PaymentRequest {
  id: number;
  order: { id: number; order_no: string; client_name: string; status: string };
  work_job: { id: number; work_details: string; start_date: string } | null;
  requester: {
    id: number;
    name: string;
    role: string;
    phone: string | null;
    emp_code: string | null;
  };
  amount: number;
  upi_method: UpiMethod;
  /** The UPI ID or the 10-digit mobile number, per upi_method. */
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
  /** Actions you may take but that are held up for now, with the reason (e.g. no bill yet). */
  blocked_actions?: Partial<Record<PaymentActionName, string>>;
  /** Live files on the request, by kind. */
  attachment_counts: Record<AttachmentKind, number>;
  /** Raised with bill details but no bill attached: it cannot be closed yet. */
  bill_missing: boolean;
  /** The kinds of file you may add now. */
  attach_kinds: AttachmentKind[];
  /** What it is waiting on and for how many working days. */
  timers: PaymentTimer[];
  /** A timer has run past the overdue limit: shown red and bold until it is resolved. */
  overdue: boolean;
  /** Reviewers only. */
  order_money?: OrderMoney;
}

export type TimerKind = "ADMIN_REVIEW" | "CCM_REVIEW" | "REPLY" | "PAYMENT" | "CLOSE" | "BILL";
export type TimerOwner = "ADMIN" | "COST_CONTROL_MANAGER" | "REQUESTER";

/** One condition a request is waiting on, counted in working days (Sundays off, India time). */
export interface PaymentTimer {
  kind: TimerKind;
  owner: TimerOwner;
  /** e.g. "Waiting for Cost Control review". */
  label: string;
  /** e.g. "Cost Control review". */
  short: string;
  since: string;
  days: number;
  overdue: boolean;
}

export const TIMER_OWNER_LABELS: Record<TimerOwner, string> = {
  ADMIN: "Admin",
  COST_CONTROL_MANAGER: "Cost Control",
  REQUESTER: "Requester",
};

export type AttachmentKind = "BILL" | "PHOTO" | "RECEIPT";

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  BILL: "Bill",
  PHOTO: "Photo",
  RECEIPT: "Payment receipt",
};

export interface PaymentAttachment {
  id: number;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size_bytes: number;
  uploader: { id: number; name: string } | null;
  uploaded_at: string;
  /** Relative to the API base; see fileUrl(). */
  url: string;
  can_remove: boolean;
  /** Removing it means removing someone else's file, which needs a reason. */
  remove_needs_note?: boolean;
}

export interface PaymentEvent {
  id: number;
  action: "SUBMIT" | "ATTACH" | "DETACH" | PaymentActionName;
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
  jobs: { id: number; work_details: string; start_date: string; status: string }[];
}

export interface PaymentList {
  requests: PaymentRequest[];
  counts: Record<PaymentStatus, number>;
  amounts: Record<PaymentStatus, number>;
  queue_statuses: PaymentStatus[];
  /** Rows in this list with an overdue timer (before the overdue-only filter). */
  overdue_count: number;
  /** Working days after which a timer turns red. */
  threshold: number;
  /** The Admin is standing in for Cost Control, as none is active. */
  acting_for_ccm?: boolean;
}

export const fetchPaymentRequests = (
  params: { scope?: "queue"; status?: string; q?: string; overdue?: "1"; order_id?: string } = {},
) => apiFetch<PaymentList>("/payment-requests", { params });

export type WaitingStatus = "ADMIN_REVIEW" | "CCM_REVIEW" | "INFO_REQUESTED" | "PAYMENT_PENDING" | "PAID";
export const WAITING_STATUSES: WaitingStatus[] = [
  "ADMIN_REVIEW",
  "CCM_REVIEW",
  "INFO_REQUESTED",
  "PAYMENT_PENDING",
  "PAID",
];

export interface OverdueItem {
  id: number;
  amount: number;
  status: PaymentStatus;
  requester: { id: number; name: string; role: string };
  order: { id: number; order_no: string; client_name: string };
  timer: PaymentTimer;
}

interface MoneyCount {
  amount: number;
  count: number;
}

/** The Admin's and Cost Control's overview: where requests wait, what is overdue, money paid. */
export interface PaymentDashboardData {
  threshold: number;
  stages: Record<WaitingStatus, { count: number; amount: number; oldest_days: number; overdue: number }>;
  waiting_on_you: { owner: TimerOwner | null; count: number; overdue: number; amount: number };
  overdue: { total: number; by_kind: Partial<Record<TimerKind, number>>; items: OverdueItem[] };
  bills_missing: number;
  money: {
    paid_this_month: MoneyCount;
    paid_last_month: MoneyCount;
    asked_this_month: MoneyCount;
    pending_payout: number;
    by_category: { category: PaymentCategory | null; amount: number; count: number }[];
  };
}

export const fetchPaymentDashboard = () =>
  apiFetch<PaymentDashboardData>("/payment-requests/dashboard");

export interface PaymentSettings {
  payment_overdue_days: number;
  /** Requests above this go to the Admin first, bill or not. */
  payment_admin_threshold: number;
}

export const fetchPaymentSettings = () => apiFetch<PaymentSettings>("/admin/payment-settings");

export const updatePaymentSettings = (data: Partial<PaymentSettings>) =>
  apiFetch<PaymentSettings>("/admin/payment-settings", {
    method: "PUT",
    data,
  });

export const fetchPaymentRequest = (id: number) =>
  apiFetch<{ request: PaymentRequest; attachments: PaymentAttachment[]; events: PaymentEvent[] }>(
    `/payment-requests/${id}`,
  );

export const fetchPaymentOrderOptions = (q: string) =>
  apiFetch<{ orders: PaymentOrderOption[] }>("/payment-requests/order-options", { params: { q } });

export interface PaymentRequestInput {
  amount: number;
  upi_method: UpiMethod;
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

/* ------------------------------------------------------------------ files */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf";

/** The full address of a file, for an <img> or a link; the session cookie authorises it. */
export const fileUrl = (path: string, download = false) =>
  `${apiClient.defaults.baseURL ?? "/api"}${path}${download ? "?download=1" : ""}`;

/**
 * Phone photos are often 3–8 MB. Large JPEG, PNG and WEBP images are scaled to 1600 px on
 * the long side and re-saved as JPEG before upload, so they stay well under the limit and
 * small in the database. PDFs, HEIC (most browsers cannot draw it) and small images go as they are.
 */
export async function prepareUpload(file: File): Promise<{ data: Blob; name: string }> {
  const asIs = { data: file as Blob, name: file.name };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700_000) return asIs;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return asIs;
    ctx.fillStyle = "#fff"; // PNG transparency would turn black in a JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob || blob.size >= file.size) return asIs;
    return { data: blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    return asIs;
  }
}

/** Upload one file to a request. The body is the file itself. */
export async function uploadPaymentFile(requestId: number, kind: AttachmentKind, file: File) {
  const { data, name } = await prepareUpload(file);
  if (data.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 5 MB.`);
  return apiFetch<{ attachment: PaymentAttachment }>(`/payment-requests/${requestId}/attachments`, {
    method: "POST",
    params: { kind, name },
    data,
    headers: { "Content-Type": data.type || "application/octet-stream" },
  });
}

export const removePaymentFile = (requestId: number, fileId: number, note?: string) =>
  apiFetch<{ ok: true }>(`/payment-requests/${requestId}/attachments/${fileId}`, {
    method: "DELETE",
    data: note ? { note } : undefined,
  });

export const formatBytes = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
