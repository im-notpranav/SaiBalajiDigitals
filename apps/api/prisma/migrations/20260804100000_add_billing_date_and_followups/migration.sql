-- Add billing_date to Order
ALTER TABLE "Order" ADD COLUMN "billing_date" TIMESTAMP(3);

-- Create PaymentFollowUp table
CREATE TABLE "PaymentFollowUp" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentFollowUp_pkey" PRIMARY KEY ("id")
);

-- Index for order_id lookups
CREATE INDEX "PaymentFollowUp_order_id_idx" ON "PaymentFollowUp"("order_id");

-- Foreign keys
ALTER TABLE "PaymentFollowUp" ADD CONSTRAINT "PaymentFollowUp_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentFollowUp" ADD CONSTRAINT "PaymentFollowUp_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
