-- Data Migration: Unsettled -> Pending
UPDATE "Order" SET status = 'Pending' WHERE status = 'Unsettled';

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
ALTER TABLE "Order" ADD COLUMN "remarks" "RemarkType", ADD COLUMN "remarks_other_text" TEXT;

-- Data Migration: closure/production remarks and order item remarks
UPDATE "Order"
SET remarks = 'Other',
    remarks_other_text = CONCAT(closure_remark_type, ': ', closure_remark_text)
WHERE closure_remark_type IS NOT NULL;

UPDATE "Order"
SET remarks = 'Other',
    remarks_other_text = CONCAT(production_remark_type, ': ', production_remark_text)
WHERE production_remark_type IS NOT NULL AND remarks IS NULL;

UPDATE "Order"
SET remarks = (
  SELECT "remarks"::text::"RemarkType" FROM "OrderItem" 
  WHERE "OrderItem"."order_id" = "Order"."id" AND "remarks" IS NOT NULL 
  LIMIT 1
)
WHERE remarks IS NULL AND EXISTS (
  SELECT 1 FROM "OrderItem" WHERE "OrderItem"."order_id" = "Order"."id" AND "remarks" IS NOT NULL
);

-- AlterTable (Drop columns after migration)
ALTER TABLE "Order" 
DROP COLUMN "closure_remark_text",
DROP COLUMN "closure_remark_type",
DROP COLUMN "production_remark_text",
DROP COLUMN "production_remark_type",
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "remarks";

-- DropEnum
DROP TYPE "ClosureRemarkType";

-- DropEnum
DROP TYPE "ProductionRemarkType";

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
