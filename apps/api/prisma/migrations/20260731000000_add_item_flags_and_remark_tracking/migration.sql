-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "flag_reason" TEXT,
ADD COLUMN     "flagged_at" TIMESTAMP(3),
ADD COLUMN     "flagged_by" INTEGER,
ADD COLUMN     "is_flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remarks_set_at" TIMESTAMP(3),
ADD COLUMN     "remarks_set_by" INTEGER;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_remarks_set_by_fkey" FOREIGN KEY ("remarks_set_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_flagged_by_fkey" FOREIGN KEY ("flagged_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

