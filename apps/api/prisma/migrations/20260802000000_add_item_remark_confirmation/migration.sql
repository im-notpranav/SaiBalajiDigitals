-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "remarks_confirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remarks_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "remarks_confirmed_by" INTEGER;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_remarks_confirmed_by_fkey" FOREIGN KEY ("remarks_confirmed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing line-item remarks predate the propose/confirm concept.
-- Treat any pre-existing remark as an already-confirmed loss so current loss data is preserved.
UPDATE "OrderItem" SET "remarks_confirmed" = true WHERE "remarks" IS NOT NULL;
