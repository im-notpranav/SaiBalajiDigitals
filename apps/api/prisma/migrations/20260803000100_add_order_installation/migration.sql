-- Installation confirmation on the order (creator marks a produced order installed).
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "installed_at" TIMESTAMP(3),
ADD COLUMN     "installed_by" INTEGER;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_installed_by_fkey" FOREIGN KEY ("installed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
