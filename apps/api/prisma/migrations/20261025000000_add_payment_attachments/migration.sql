-- CreateEnum
CREATE TYPE "PaymentAttachmentKind" AS ENUM ('BILL', 'PHOTO', 'RECEIPT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentAction" ADD VALUE 'ATTACH';
ALTER TYPE "PaymentAction" ADD VALUE 'DETACH';

-- CreateTable
CREATE TABLE "PaymentAttachment" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" "PaymentAttachmentKind" NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'db',
    "storage_key" TEXT,
    "uploaded_by" INTEGER,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" INTEGER,

    CONSTRAINT "PaymentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttachmentBlob" (
    "attachment_id" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "PaymentAttachmentBlob_pkey" PRIMARY KEY ("attachment_id")
);

-- CreateIndex
CREATE INDEX "PaymentAttachment_request_id_idx" ON "PaymentAttachment"("request_id");

-- CreateIndex
CREATE INDEX "PaymentAttachment_order_id_idx" ON "PaymentAttachment"("order_id");

-- AddForeignKey
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttachmentBlob" ADD CONSTRAINT "PaymentAttachmentBlob_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "PaymentAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;




-- 5 MB per file, checked again here in case the API's own check is ever bypassed.
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880);
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_mime_check"
    CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'));
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_storage_check" CHECK ("storage" IN ('db', 'r2'));

-- The same file cannot be attached twice to one request (removed copies excepted).
-- An exclusion constraint rather than a partial unique index, which Prisma cannot describe.
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_no_duplicate"
    EXCLUDE USING btree ("request_id" WITH =, "sha256" WITH =) WHERE ("deleted_at" IS NULL);

-- Audited like the other payment tables. The blob table is not: it never changes, and
-- copying file bytes into the audit log would bloat it.
DROP TRIGGER IF EXISTS trg_payment_attachment_audit ON "PaymentAttachment";
CREATE TRIGGER trg_payment_attachment_audit AFTER UPDATE OR DELETE ON "PaymentAttachment"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
