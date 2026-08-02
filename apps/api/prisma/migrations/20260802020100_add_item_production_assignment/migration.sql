-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "assigned_by" INTEGER,
ADD COLUMN     "assigned_to" INTEGER,
ADD COLUMN     "production_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "production_completed_at" TIMESTAMP(3),
ADD COLUMN     "production_completed_by" INTEGER;

-- CreateIndex
CREATE INDEX "OrderItem_assigned_to_idx" ON "OrderItem"("assigned_to");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_production_completed_by_fkey" FOREIGN KEY ("production_completed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
