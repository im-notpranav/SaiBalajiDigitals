/**
 * Every WhatsApp message the system sends, defined once. Business-initiated WhatsApp
 * messages must use templates Meta has approved, so each event names a template that has
 * to be created in AskEva with exactly this text (category: Utility, language: English).
 *
 * {{1}} is always the recipient's first name and is filled in by the outbox; callers pass
 * the remaining variables in order. Meta rejects templates that start or end with a
 * variable, so every text opens with "Hi" and ends with fixed words.
 */
export const WA_TEMPLATES = {
  JOB_ASSIGNED: {
    template: "sbd_job_assigned",
    body: "Hi {{1}}, you are on a new job. Order: {{2}}. Work: {{3}}. Location: {{4}}. Dates: {{5}}. Open My Work in the Sai Balaji app for the details.",
    vars: ["Order number or 'order to be confirmed'", "Work", "Area", "Dates"],
  },
  JOB_REMOVED: {
    template: "sbd_job_removed",
    body: "Hi {{1}}, you are no longer on this job. Order: {{2}}. Work: {{3}}. Location: {{4}}. Dates: {{5}}. Please check My Work for your current jobs.",
    vars: ["Order number or 'order to be confirmed'", "Work", "Area", "Dates"],
  },
  JOB_CANCELLED: {
    template: "sbd_job_cancelled",
    body: "Hi {{1}}, this job has been cancelled. Order: {{2}}. Work: {{3}}. Location: {{4}}. Dates: {{5}}. Reason: {{6}}. Please check My Work for your current jobs.",
    vars: ["Order number or 'order to be confirmed'", "Work", "Area", "Dates", "Reason"],
  },
  JOB_UPDATE: {
    template: "sbd_job_update",
    body: "Hi {{1}}, a job is now {{4}}. Order: {{2}}. Work: {{3}}. Details: {{5}}. Open the Sai Balaji app for more.",
    vars: ["Order number or 'order to be confirmed'", "Work", "Status", "Details"],
  },
  PAYMENT_TO_REVIEW: {
    template: "sbd_payment_to_review",
    body: "Hi {{1}}, a payment request on order {{2}} for {{3}} from {{4}} is waiting for your review. Note: {{5}}. Open the Sai Balaji app to review it.",
    vars: ["Order number", "Amount", "Requester", "Note"],
  },
  PAYMENT_WITHDRAWN: {
    template: "sbd_payment_withdrawn",
    body: "Hi {{1}}, the payment request on order {{2}} for {{3}} from {{4}} was withdrawn by the requester. No action is needed.",
    vars: ["Order number", "Amount", "Requester"],
  },
  PAYMENT_UPDATE: {
    template: "sbd_payment_update",
    body: "Hi {{1}}, your payment request on order {{2}} for {{3}} is {{4}}. Details: {{5}}. Open the Sai Balaji app for more.",
    vars: ["Order number", "Amount", "Outcome", "Details"],
  },
  PAYMENT_PAID: {
    template: "sbd_payment_paid",
    body: "Hi {{1}}, {{2}} has been paid to {{3}} for your payment request on order {{4}}. Payment reference: {{5}}. Thank you.",
    vars: ["Amount paid", "UPI ID or mobile", "Order number", "Reference"],
  },
  ORDER_UPDATE: {
    template: "sbd_order_update",
    body: "Hi {{1}}, update on order {{2}} for {{3}}: {{4}}. Open the Sai Balaji app for more.",
    vars: ["Order number", "Client", "Update"],
  },
} as const satisfies Record<string, { template: string; body: string; vars: readonly string[] }>;

export type WaEvent = keyof typeof WA_TEMPLATES;

/**
 * Every template also carries one button. In AskEva: a "Visit website" button with this text
 * and a dynamic URL `{APP_URL}/go/{{1}}`; the outbox fills {{1}} with the message's link
 * ("pr/28", "job/12/30", "order/30"), and the web app's /go page opens the right screen.
 */
export const WA_BUTTON_TEXT = "Open in app";

/** A believable button value per event, for the template's sample in AskEva. */
export const sampleLink = (event: WaEvent) => (event.startsWith("JOB_") ? "job/12/30" : event.startsWith("PAYMENT_") ? "pr/28" : "order/30");

/** Longest a single variable may be; the whole body must stay under WhatsApp's 1024. */
const MAX_PARAM = 160;

/**
 * WhatsApp refuses template variables that are empty or hold new lines, tabs or runs of
 * spaces, so every value is flattened to one tidy line first.
 */
export function cleanParam(value: unknown): string {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "-";
  return flat.length > MAX_PARAM ? `${flat.slice(0, MAX_PARAM - 1)}…` : flat;
}

/** The text the person will read, for the delivery log. */
export function renderPreview(event: WaEvent, params: string[]): string {
  return WA_TEMPLATES[event].body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/** "Mahesh Kumar" → "Mahesh": the greeting uses first names. */
export const firstName = (name: string) => cleanParam(name.split(/\s+/)[0]);
