-- Revised, Extra Amount and Less Amount on line items, and whole-order Extra / Less
-- Amount adjustments that sit on one store. The RemarkType enum already has all three.

-- Line items: the Extra / Less figure, and the amount before a Revised correction.
ALTER TABLE "OrderItem" ADD COLUMN "adjustment_amount" DECIMAL(10,2);
ALTER TABLE "OrderItem" ADD COLUMN "original_amount" DECIMAL(10,2);

CREATE TYPE "AdjustmentStatus" AS ENUM ('Requested', 'Approved', 'Rejected');

CREATE TABLE "OrderAdjustment" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "order_store_id" INTEGER NOT NULL,
    "type" "RemarkType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "requested_amount" DECIMAL(10,2),
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'Requested',
    "requested_by" INTEGER,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderAdjustment_type_check" CHECK ("type" IN ('ExtraAmount', 'LessAmount')),
    CONSTRAINT "OrderAdjustment_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "OrderAdjustment_order_id_idx" ON "OrderAdjustment"("order_id");
CREATE INDEX "OrderAdjustment_order_store_id_idx" ON "OrderAdjustment"("order_store_id");
CREATE INDEX "OrderAdjustment_status_idx" ON "OrderAdjustment"("status");

ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite, like OrderItem: an adjustment cannot name a store from another order.
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_order_id_order_store_id_fkey"
    FOREIGN KEY ("order_id", "order_store_id") REFERENCES "OrderStore"("order_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit coverage, matching "OrderItem" and "Invoice".
DROP TRIGGER IF EXISTS trg_order_adjustment_audit ON "OrderAdjustment";
CREATE TRIGGER trg_order_adjustment_audit AFTER UPDATE OR DELETE ON "OrderAdjustment"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
