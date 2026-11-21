-- Nov 17 change list, batch 2 (2026-11-22): Request Change, combine orders, field job hold/cancel/reject asks, send-back.
-- CreateEnum
CREATE TYPE "FieldJobFlag" AS ENUM ('HOLD', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChangeRequestKind" AS ENUM ('LINE_EDIT', 'COMBINE_ORDERS', 'RATE_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "merged_into_id" INTEGER,
ADD COLUMN     "merged_into_no" TEXT;

-- AlterTable
ALTER TABLE "WorkJob" ADD COLUMN     "field_flag" "FieldJobFlag",
ADD COLUMN     "field_flag_at" TIMESTAMP(3),
ADD COLUMN     "field_flag_by" INTEGER,
ADD COLUMN     "field_flag_reason" TEXT,
ADD COLUMN     "sent_back_at" TIMESTAMP(3),
ADD COLUMN     "sent_back_by" INTEGER,
ADD COLUMN     "sent_back_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sent_back_reason" TEXT;

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" "ChangeRequestKind" NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "other_order_id" INTEGER,
    "requested_by" INTEGER,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeRequest_order_id_idx" ON "ChangeRequest"("order_id");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_created_at_idx" ON "ChangeRequest"("status", "created_at");

-- CreateIndex
CREATE INDEX "ChangeRequest_requested_by_idx" ON "ChangeRequest"("requested_by");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_field_flag_by_fkey" FOREIGN KEY ("field_flag_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_sent_back_by_fkey" FOREIGN KEY ("sent_back_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

