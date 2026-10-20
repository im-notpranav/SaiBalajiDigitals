-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'LOGGED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "whatsapp_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "user_id" INTEGER,
    "to_phone" TEXT,
    "params" JSONB NOT NULL,
    "preview" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" INTEGER,
    "status" "WhatsAppStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_message_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_provider_message_id_key" ON "WhatsAppMessage"("provider_message_id");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_next_attempt_at_idx" ON "WhatsAppMessage"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_created_at_idx" ON "WhatsAppMessage"("created_at");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_user_id_idx" ON "WhatsAppMessage"("user_id");

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Phone numbers are stored in E.164 (+91XXXXXXXXXX for India).
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_phone_check"
    CHECK ("to_phone" IS NULL OR "to_phone" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_params_check"
    CHECK (jsonb_typeof("params") = 'array');
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_attempts_check" CHECK ("attempts" >= 0);
-- Only a message AskEva accepted can be sent, delivered or read, and it has AskEva's id.
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_provider_id_check"
    CHECK ("status" NOT IN ('SENT', 'DELIVERED', 'READ') OR "provider_message_id" IS NOT NULL);
-- A message that went anywhere had a number to go to.
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sent_phone_check"
    CHECK ("status" IN ('SKIPPED', 'QUEUED', 'FAILED') OR "to_phone" IS NOT NULL);
