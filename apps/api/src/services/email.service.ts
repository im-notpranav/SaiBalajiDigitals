import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const adminEmail = process.env.ADMIN_EMAIL || "admin@saibalaji.com";

export async function initEmailService() {
  try {
    await transporter.verify();
    console.log("✅ Email service initialized successfully");
  } catch (err) {
    console.error("❌ Email service failed to connect:", err);
  }
}

interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export async function sendOrderEditEmail(
  orderNo: string,
  employeeName: string,
  changes: FieldChange[]
) {
  if (changes.length === 0) return;

  const rows = changes
    .map(
      (c) =>
        `<tr>
          <td style="padding:8px;border:1px solid #ddd;">${c.field}</td>
          <td style="padding:8px;border:1px solid #ddd;color:red;">${c.oldValue}</td>
          <td style="padding:8px;border:1px solid #ddd;color:green;">${c.newValue}</td>
        </tr>`
    )
    .join("");

  const html = `
    <h3>Order Edited: ${orderNo}</h3>
    <p>Employee <strong>${employeeName}</strong> made the following changes:</p>
    <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Field</th>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">Old Value</th>
          <th style="padding:8px;border:1px solid #ddd;background:#f5f5f5;">New Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  await transporter.sendMail({
    from: '"OMS System" <noreply@saibalaji.com>',
    to: adminEmail,
    subject: `[Order Edit] ${orderNo} modified by ${employeeName}`,
    html,
  }).catch(console.error);
}

export async function sendItemFlagEmail(
  orderNo: string,
  employeeName: string,
  itemLabel: string,
  note: string
) {
  const html = `
    <h3>Line Item Flagged: ${orderNo}</h3>
    <p>Employee <strong>${employeeName}</strong> flagged a line item that needs your attention
    (line items are append-only, so this is a correction request — not a direct edit).</p>
    <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
      <tr>
        <td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;width:120px;"><strong>Order</strong></td>
        <td style="padding:8px;border:1px solid #ddd;">${orderNo}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;"><strong>Line Item</strong></td>
        <td style="padding:8px;border:1px solid #ddd;">${itemLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;"><strong>Note</strong></td>
        <td style="padding:8px;border:1px solid #ddd;color:#b45309;">${note || "(no note provided)"}</td>
      </tr>
    </table>
    <p>Review it in the Admin portal and apply any correction as a new/adjusted line.</p>
  `;

  await transporter.sendMail({
    from: '"OMS System" <noreply@saibalaji.com>',
    to: adminEmail,
    subject: `[Flag] ${orderNo} — line item flagged by ${employeeName}`,
    html,
  }).catch(console.error);
}

export async function sendPendingInvoiceEmail(
  orderNo: string,
  clientName: string,
  orderTotal: number,
  billAmount: number
) {
  const diff = Math.abs(orderTotal - billAmount).toFixed(2);
  const html = `
    <h3>Invoice Mismatch: ${orderNo}</h3>
    <p>An invoice was submitted for <strong>${clientName}</strong> that does not match the computed order total. The order has been marked as <strong>Pending</strong>.</p>
    <ul>
      <li><strong>Order Total:</strong> ₹${orderTotal.toFixed(2)}</li>
      <li><strong>Bill Amount:</strong> ₹${billAmount.toFixed(2)}</li>
      <li><strong>Difference:</strong> ₹${diff}</li>
    </ul>
    <p>Please review and close this order via the Admin portal once resolved.</p>
  `;

  await transporter.sendMail({
    from: '"OMS System" <noreply@saibalaji.com>',
    to: adminEmail,
    subject: `[Pending Order] Invoice Mismatch on ${orderNo}`,
    html,
  }).catch(console.error);
}
