-- Payment tracking on the order (Phase 5 billing split).
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "amount_received" DECIMAL(10,2),
ADD COLUMN     "billing_completed_at" TIMESTAMP(3),
ADD COLUMN     "payment_received_at" TIMESTAMP(3),
ADD COLUMN     "payment_received_by" INTEGER;

-- Single-assignee columns are replaced by the OrderItemAssignment join table below.
-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "assigned_at",
DROP COLUMN "assigned_by",
DROP COLUMN "assigned_to",
DROP COLUMN "production_completed_by";

-- CreateTable
CREATE TABLE "OrderItemAssignment" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "OrderItemAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItemAssignment_user_id_idx" ON "OrderItemAssignment"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemAssignment_order_item_id_user_id_key" ON "OrderItemAssignment"("order_item_id", "user_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_payment_received_by_fkey" FOREIGN KEY ("payment_received_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAssignment" ADD CONSTRAINT "OrderItemAssignment_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAssignment" ADD CONSTRAINT "OrderItemAssignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAssignment" ADD CONSTRAINT "OrderItemAssignment_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
