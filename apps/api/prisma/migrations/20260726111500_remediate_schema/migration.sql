-- Data Migration: Unsettled -> Pending
UPDATE "Order" SET status = 'Pending' WHERE status::text = 'Unsettled';

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('Active', 'Pending', 'Completed');
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'Active';
COMMIT;

-- AlterEnum
ALTER TYPE "RemarkType" ADD VALUE 'Other';

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_created_by_fkey";

-- AlterTable (Add columns first for data migration)
ALTER TABLE "Order" ADD COLUMN "remarks_other_text" TEXT;

-- AlterTable (Drop columns after migration)
ALTER TABLE "Order" 
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
-- (Removed DROP COLUMN remarks from OrderItem)

-- DropEnum
-- (Removed DROP TYPE ClosureRemarkType)

-- DropEnum
-- (Removed DROP TYPE ProductionRemarkType)

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
