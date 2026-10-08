import nodemailer from "nodemailer";
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ADMIN_EMAIL } from "../utils/config";

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: parseInt(SMTP_PORT),
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

const adminEmail = ADMIN_EMAIL;
const FROM = '"Sai Balaji OMS" <noreply@saibalaji.com>';

export async function initEmailService() {
  if (!SMTP_HOST) {
    console.warn("⚠️  SMTP is not configured — email notifications are disabled.");
    return;
  }
  try {
    await transporter.verify();
    console.log("✅ Email service initialized successfully");
  } catch (err) {
    console.error("❌ Email service failed to connect:", err);
  }
}

function wrap(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f3f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <tr><td style="background:#1a5c45;padding:20px 28px;">
        <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.3px;">Sai Balaji Digitals</h1>
        <p style="margin:4px 0 0;color:#a3d9c5;font-size:12px;letter-spacing:0.5px;">ORDER MANAGEMENT SYSTEM</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <h2 style="margin:0 0 16px;font-size:16px;color:#1a1713;font-weight:600;">${title}</h2>
        ${body}
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9f8f5;border-top:1px solid #e8e6e0;">
        <p style="margin:0;font-size:11px;color:#8a847a;text-align:center;">This is an automated notification from Sai Balaji Digitals OMS. Do not reply to this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:13px;color:#7a7468;font-weight:500;width:140px;vertical-align:top;">${label}</td>
    <td style="padding:8px 12px;border:1px solid #e8e6e0;font-size:13px;color:#1a1713;">${value}</td>
  </tr>`;
}

function table(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">${rows}</table>`;
}

function badge(text: string, color: string): string {
  const colors: Record<string, string> = {
    green: "background:#e8f3ee;color:#145240;",
    red: "background:#fef0e8;color:#9f4417;",
    blue: "background:#e8f1fa;color:#185fa5;",
    amber: "background:#fef3e2;color:#854f0b;",
    gray: "background:#f1efe8;color:#5f5e5a;",
  };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:500;${colors[color] || colors.gray}">${text}</span>`;
}

function changeTable(changes: FieldChange[]): string {
  const header = `<tr>
    <th style="padding:8px 12px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:12px;color:#7a7468;text-align:left;font-weight:500;">Field</th>
    <th style="padding:8px 12px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:12px;color:#7a7468;text-align:left;font-weight:500;">Previous value</th>
    <th style="padding:8px 12px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:12px;color:#7a7468;text-align:left;font-weight:500;">New value</th>
  </tr>`;
  const rows = changes
    .map(
      (c) => `<tr>
        <td style="padding:8px 12px;border:1px solid #e8e6e0;font-size:13px;color:#1a1713;font-weight:500;">${c.field}</td>
        <td style="padding:8px 12px;border:1px solid #e8e6e0;font-size:13px;color:#9f4417;text-decoration:line-through;">${c.oldValue || "—"}</td>
        <td style="padding:8px 12px;border:1px solid #e8e6e0;font-size:13px;color:#145240;font-weight:500;">${c.newValue || "—"}</td>
      </tr>`
    )
    .join("");
  return table(header + rows);
}

function itemsTable(items: OrderItemSummary[]): string {
  const header = `<tr>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:left;">#</th>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:left;">Media</th>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:right;">Size (in)</th>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:right;">Qty</th>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:right;">SFT</th>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:right;">Rate</th>
    <th style="padding:6px 10px;border:1px solid #e8e6e0;background:#f9f8f5;font-size:11px;color:#7a7468;text-align:right;">Amount</th>
  </tr>`;
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#7a7468;text-align:left;">${i.s_no}</td>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;">${i.media}</td>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;text-align:right;">${i.width} × ${i.height}</td>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;text-align:right;">${i.qty}</td>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;text-align:right;">${i.sft}</td>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;text-align:right;">₹${i.rate}</td>
        <td style="padding:6px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;text-align:right;font-weight:500;">₹${i.amount}</td>
      </tr>`
    )
    .join("");
  const totalAmount = items.reduce((s, i) => s + Number(i.amount), 0).toFixed(2);
  const totalRow = `<tr>
    <td colspan="6" style="padding:8px 10px;border:1px solid #e8e6e0;font-size:12px;color:#1a1713;text-align:right;font-weight:600;">Total</td>
    <td style="padding:8px 10px;border:1px solid #e8e6e0;font-size:13px;color:#1a1713;text-align:right;font-weight:600;">₹${totalAmount}</td>
  </tr>`;
  return table(header + rows + totalRow);
}

function sendMail(to: string, subject: string, html: string) {
  return transporter.sendMail({ from: FROM, to, subject, html }).catch((err) => {
    console.error(`Email send failed [${subject}]:`, err.message);
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export interface OrderItemSummary {
  s_no: number;
  media: string;
  width: string;
  height: string;
  qty: string;
  sft: string;
  rate: string;
  amount: string;
}

export interface OrderSummary {
  order_no: string;
  client_name: string;
  store_name: string;
  location: string;
  po_number?: string | null;
  date: string;
  total_amount: string;
  status: string;
}

function orderSummaryRows(o: OrderSummary): string {
  return infoRow("Order No.", `<strong>${o.order_no}</strong>`) +
    infoRow("Client", o.client_name) +
    infoRow("Store", o.store_name) +
    infoRow("Location", o.location) +
    (o.po_number ? infoRow("PO Number", o.po_number) : "") +
    infoRow("Date", o.date) +
    infoRow("Total Amount", `<strong>₹${o.total_amount}</strong>`) +
    infoRow("Status", badge(o.status, o.status === "Active" ? "blue" : o.status === "Completed" || o.status === "PaymentReceived" ? "green" : "amber"));
}

// ─── Email functions ─────────────────────────────────────────────────────────

export async function sendOrderCreatedEmail(
  recipientEmail: string,
  employeeName: string,
  order: OrderSummary,
  items: OrderItemSummary[]
) {
  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      A new order has been created by <strong>${employeeName}</strong>. Below are the complete details.
    </p>
    <h3 style="margin:0 0 8px;font-size:13px;color:#7a7468;text-transform:uppercase;letter-spacing:0.5px;">Order details</h3>
    ${table(orderSummaryRows(order))}
    <h3 style="margin:20px 0 8px;font-size:13px;color:#7a7468;text-transform:uppercase;letter-spacing:0.5px;">Line items (${items.length})</h3>
    ${itemsTable(items)}
  `;
  await sendMail(recipientEmail, `[New Order] ${order.order_no} — ${order.client_name}`, wrap("New order created", body));
}

export async function sendOrderEditEmail(
  orderNo: string,
  employeeName: string,
  changes: FieldChange[]
) {
  if (changes.length === 0) return;

  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      <strong>${employeeName}</strong> made the following changes to order <strong>${orderNo}</strong>.
      Please review the changes below and take action if required.
    </p>
    <h3 style="margin:0 0 8px;font-size:13px;color:#7a7468;text-transform:uppercase;letter-spacing:0.5px;">Changes made</h3>
    ${changeTable(changes)}
    <div style="margin:16px 0;padding:12px 16px;background:#fef3e2;border-left:3px solid #b5600e;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#854f0b;">
        <strong>Action required:</strong> Review these changes in the Admin portal. All edits are recorded in the audit log.
      </p>
    </div>
  `;
  await sendMail(adminEmail, `[Order Edit] ${orderNo} — modified by ${employeeName}`, wrap("Order edited", body));
}

export async function sendItemFlagEmail(
  orderNo: string,
  employeeName: string,
  itemLabel: string,
  note: string
) {
  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      <strong>${employeeName}</strong> has flagged a line item on order <strong>${orderNo}</strong> that requires your attention.
      Line items are append-only for employees — this is a correction request, not a direct edit.
    </p>
    <h3 style="margin:0 0 8px;font-size:13px;color:#7a7468;text-transform:uppercase;letter-spacing:0.5px;">Flagged item details</h3>
    ${table(
      infoRow("Order", `<strong>${orderNo}</strong>`) +
      infoRow("Line Item", itemLabel) +
      infoRow("Flagged By", employeeName) +
      infoRow("Reason", note || "<em style='color:#8a847a;'>(no note provided)</em>")
    )}
    <div style="margin:16px 0;padding:12px 16px;background:#fef0e8;border-left:3px solid #9f4417;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#9f4417;">
        <strong>Action required:</strong> Review the flagged item in the Admin portal and apply any correction as a new or adjusted line item.
      </p>
    </div>
  `;
  await sendMail(adminEmail, `[Flag] ${orderNo} — line item flagged by ${employeeName}`, wrap("Line item flagged", body));
}

export async function sendPendingInvoiceEmail(
  orderNo: string,
  clientName: string,
  orderTotal: number,
  billAmount: number
) {
  const diff = Math.abs(orderTotal - billAmount).toFixed(2);
  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      An invoice has been submitted for order <strong>${orderNo}</strong> (${clientName}) that does not match
      the computed order total. The order has been marked as <strong>Pending</strong> and requires review.
    </p>
    <h3 style="margin:0 0 8px;font-size:13px;color:#7a7468;text-transform:uppercase;letter-spacing:0.5px;">Invoice mismatch details</h3>
    ${table(
      infoRow("Order", `<strong>${orderNo}</strong>`) +
      infoRow("Client", clientName) +
      infoRow("Order Total", `₹${orderTotal.toFixed(2)}`) +
      infoRow("Bill Amount", `₹${billAmount.toFixed(2)}`) +
      infoRow("Difference", `<strong style="color:#9f4417;">₹${diff}</strong>`) +
      infoRow("Status", badge("Pending", "amber"))
    )}
    <div style="margin:16px 0;padding:12px 16px;background:#fef3e2;border-left:3px solid #b5600e;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#854f0b;">
        <strong>Action required:</strong> Review the invoice mismatch and close this order via the Admin portal once resolved.
      </p>
    </div>
  `;
  await sendMail(adminEmail, `[Pending Order] Invoice mismatch on ${orderNo}`, wrap("Invoice mismatch", body));
}

export async function sendBillingEditEmail(
  orderNo: string,
  editorName: string,
  editorRole: string,
  changes: FieldChange[]
) {
  if (changes.length === 0) return;

  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      Billing or payment details for order <strong>${orderNo}</strong> have been modified by
      <strong>${editorName}</strong> (${editorRole}). Please review the changes below.
    </p>
    <h3 style="margin:0 0 8px;font-size:13px;color:#7a7468;text-transform:uppercase;letter-spacing:0.5px;">Changes to billing/payment</h3>
    ${changeTable(changes)}
    <div style="margin:16px 0;padding:12px 16px;background:#fef0e8;border-left:3px solid #9f4417;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#9f4417;">
        <strong>Attention:</strong> Financial data has been modified. Verify these changes are correct.
        All modifications are recorded in the audit log with full before-and-after snapshots.
      </p>
    </div>
  `;
  await sendMail(adminEmail, `[Billing Edit] ${orderNo} — modified by ${editorName}`, wrap("Billing details modified", body));
}

export async function sendStatusTransitionEmail(
  recipientEmail: string,
  orderNo: string,
  clientName: string,
  transition: string,
  details: string,
  actionBy: string
) {
  const colorMap: Record<string, string> = {
    "Production Complete": "blue",
    "Installation Confirmed": "blue",
    "Billing Completed": "amber",
    "Payment Received": "green",
    "Order Completed": "green",
  };
  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      Order <strong>${orderNo}</strong> (${clientName}) has reached a new stage in its workflow.
    </p>
    ${table(
      infoRow("Order", `<strong>${orderNo}</strong>`) +
      infoRow("Client", clientName) +
      infoRow("Transition", badge(transition, colorMap[transition] || "gray")) +
      infoRow("Action By", actionBy) +
      infoRow("Details", details)
    )}
  `;
  await sendMail(recipientEmail, `[${transition}] ${orderNo} — ${clientName}`, wrap(transition, body));
}

/**
 * Send an Excel export as an email attachment.
 */
export async function sendExcelEmail(
  to: string,
  subject: string,
  messageBody: string,
  xlsxBuffer: Buffer,
  filename: string,
  senderName: string,
) {
  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#3d3830;line-height:1.6;">
      ${messageBody.replace(/\n/g, "<br>")}
    </p>
    ${table(
      infoRow("Sent by", senderName) +
      infoRow("Attachment", `📎 ${filename}`)
    )}
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject,
    html: wrap("Excel Export", body),
    attachments: [
      {
        filename,
        content: xlsxBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}

export { adminEmail };
