import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

export async function sendAdminEmail(subject: string, html: string) {
  const to = process.env.ADMIN_EMAIL;
  if (!to || !process.env.SMTP_HOST) {
    console.log("[email skipped]", subject);
    return;
  }
  await transporter.sendMail({
    from: process.env.SMTP_USER ?? "noreply@saibalaji.com",
    to,
    subject,
    html,
  });
}

export function orderChangeEmailHtml(
  orderNo: string,
  employeeName: string,
  rows: Array<{ field: string; old: string; new: string }>,
) {
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td style="padding:8px;border:1px solid #ddd">${r.field}</td><td style="padding:8px;border:1px solid #ddd">${r.old}</td><td style="padding:8px;border:1px solid #ddd">${r.new}</td></tr>`,
    )
    .join("");
  return `
    <h2>Order ${orderNo} edited by ${employeeName}</h2>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th>Field</th><th>Old</th><th>New</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

export function invoiceMismatchEmailHtml(
  orderNo: string,
  client: string,
  orderTotal: string,
  billAmount: string,
  difference: string,
) {
  return `
    <h2>Invoice mismatch — ${orderNo}</h2>
    <p><strong>Client:</strong> ${client}</p>
    <p><strong>Order total:</strong> ₹${orderTotal}</p>
    <p><strong>Bill amount:</strong> ₹${billAmount}</p>
    <p><strong>Difference:</strong> ₹${difference}</p>
    <p>Order status set to Pending for admin review.</p>
  `;
}
