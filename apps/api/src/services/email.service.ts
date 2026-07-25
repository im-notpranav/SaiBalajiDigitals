import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "2525"),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const adminEmail = process.env.ADMIN_EMAIL || "admin@saibalaji.com";

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
