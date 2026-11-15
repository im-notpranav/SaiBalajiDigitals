-- Nov 15 follow-ups (2026-11-16).
-- 1. Every notification can say where clicking it goes, not only order ones.
ALTER TABLE "Notification" ADD COLUMN "link" TEXT;

-- 2. A production team member can send a wrongly given line item back to the Production Manager.
ALTER TABLE "OrderItem" ADD COLUMN "returned_reason" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "returned_at" TIMESTAMP(3);
ALTER TABLE "OrderItem" ADD COLUMN "returned_by" INTEGER;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_returned_by_fkey"
  FOREIGN KEY ("returned_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Accounts can remind a CSM to send invoice details; kept to one reminder an hour per order.
ALTER TABLE "Order" ADD COLUMN "invoice_reminded_at" TIMESTAMP(3);
