-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "link" TEXT;


-- Only the short paths the web app's /go page understands: "pr/28", "job/12/30", "order/30".
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_link_check"
    CHECK ("link" IS NULL OR "link" ~ '^[a-z]+(/[0-9]+){1,2}$');
