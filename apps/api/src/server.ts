// Config import must come first — it loads dotenv and validates required env vars.
import { PORT } from "./utils/config";

import app from "./app";
import { initEmailService } from "./services/email.service";
import { startWhatsAppSender } from "./services/whatsapp/outbox";
import { startPaymentReminders } from "./services/payment-reminders";

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await initEmailService();
  startWhatsAppSender();
  startPaymentReminders();
});
