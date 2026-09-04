-- Multi-store orders and multiple invoices per order.
--
-- Additive only. Every legacy column on "Order" (store_name, location, invoice_no,
-- bill_amount, billing_date, billing_completed_at, amount_received, payment_received_at,
-- payment_received_by, installed_at, installed_by) is left in place and still written by
-- the application; they are dropped in a later migration once every read path has moved.
--
-- Each existing order is backfilled into a single-store order. Orders that already carry
-- an invoice_no get one Invoice row covering that single store, so the historical billing
-- state survives unchanged.

-- ---------------------------------------------------------------------------
-- 1. Invoice
-- ---------------------------------------------------------------------------
CREATE TABLE "Invoice" (
    "id"                   SERIAL           NOT NULL,
    "order_id"             INTEGER          NOT NULL,
    "invoice_no"           TEXT             NOT NULL,
    "bill_amount"          DECIMAL(10,2)    NOT NULL,
    "billing_date"         TIMESTAMP(3),
    "billing_completed_at" TIMESTAMP(3),
    "amount_received"      DECIMAL(10,2),
    "payment_received_at"  TIMESTAMP(3),
    "payment_received_by"  INTEGER,
    "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- Scoped to the order, not global: historical invoice numbers are not globally unique
-- and a global constraint would fail this migration outright.
CREATE UNIQUE INDEX "Invoice_order_id_invoice_no_key" ON "Invoice"("order_id", "invoice_no");
CREATE INDEX "Invoice_order_id_idx" ON "Invoice"("order_id");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_payment_received_by_fkey"
    FOREIGN KEY ("payment_received_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. OrderStore
-- ---------------------------------------------------------------------------
CREATE TABLE "OrderStore" (
    "id"           SERIAL       NOT NULL,
    "order_id"     INTEGER      NOT NULL,
    "s_no"         INTEGER      NOT NULL,
    "store_name"   TEXT         NOT NULL,
    "location"     TEXT         NOT NULL,
    "po_number"    TEXT,
    "installed_at" TIMESTAMP(3),
    "installed_by" INTEGER,
    "invoice_id"   INTEGER,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderStore_pkey" PRIMARY KEY ("id")
);

-- Redundant against the primary key, but required as the target of OrderItem's
-- composite foreign key below. That composite key is what makes it impossible for a
-- line item to point at a store belonging to a different order.
CREATE UNIQUE INDEX "OrderStore_order_id_id_key" ON "OrderStore"("order_id", "id");
CREATE UNIQUE INDEX "OrderStore_order_id_s_no_key" ON "OrderStore"("order_id", "s_no");
CREATE INDEX "OrderStore_order_id_idx" ON "OrderStore"("order_id");
CREATE INDEX "OrderStore_invoice_id_idx" ON "OrderStore"("invoice_id");
CREATE INDEX "OrderStore_store_name_idx" ON "OrderStore"("store_name");

ALTER TABLE "OrderStore" ADD CONSTRAINT "OrderStore_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStore" ADD CONSTRAINT "OrderStore_installed_by_fkey"
    FOREIGN KEY ("installed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderStore" ADD CONSTRAINT "OrderStore_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. OrderItem gains a store, keeping its existing order_id
-- ---------------------------------------------------------------------------
ALTER TABLE "OrderItem" ADD COLUMN "order_store_id" INTEGER;

-- ---------------------------------------------------------------------------
-- 4. Backfill: one store per existing order
-- ---------------------------------------------------------------------------
-- po_number is deliberately not copied down. The single legacy PO becomes the
-- job-level PO and stays on "Order"; per-store POs start empty.
INSERT INTO "OrderStore" (
    "order_id", "s_no", "store_name", "location",
    "installed_at", "installed_by", "created_at", "updated_at"
)
SELECT o."id", 1, o."store_name", o."location",
       o."installed_at", o."installed_by", o."created_at", o."updated_at"
FROM "Order" o;

-- ---------------------------------------------------------------------------
-- 5. Backfill: one invoice per already-invoiced order
-- ---------------------------------------------------------------------------
INSERT INTO "Invoice" (
    "order_id", "invoice_no", "bill_amount", "billing_date", "billing_completed_at",
    "amount_received", "payment_received_at", "payment_received_by", "created_at", "updated_at"
)
SELECT o."id", o."invoice_no", COALESCE(o."bill_amount", 0), o."billing_date", o."billing_completed_at",
       o."amount_received", o."payment_received_at", o."payment_received_by", o."created_at", o."updated_at"
FROM "Order" o
WHERE o."invoice_no" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Link each backfilled store to its order's invoice
-- ---------------------------------------------------------------------------
UPDATE "OrderStore" os
SET "invoice_id" = i."id"
FROM "Invoice" i
WHERE i."order_id" = os."order_id";

-- ---------------------------------------------------------------------------
-- 7. Point every existing line item at its order's store
-- ---------------------------------------------------------------------------
UPDATE "OrderItem" oi
SET "order_store_id" = os."id"
FROM "OrderStore" os
WHERE os."order_id" = oi."order_id";

-- ---------------------------------------------------------------------------
-- 8. Guard: refuse to continue if anything was left behind
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_orphan_items  INTEGER;
    v_missing_store INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_orphan_items FROM "OrderItem" WHERE "order_store_id" IS NULL;
    IF v_orphan_items > 0 THEN
        RAISE EXCEPTION 'Backfill incomplete: % OrderItem row(s) have no order_store_id', v_orphan_items;
    END IF;

    SELECT COUNT(*) INTO v_missing_store
    FROM "Order" o
    WHERE NOT EXISTS (SELECT 1 FROM "OrderStore" os WHERE os."order_id" = o."id");
    IF v_missing_store > 0 THEN
        RAISE EXCEPTION 'Backfill incomplete: % Order row(s) have no store', v_missing_store;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Now that every row is populated, tighten the column and add the composite FK
-- ---------------------------------------------------------------------------
ALTER TABLE "OrderItem" ALTER COLUMN "order_store_id" SET NOT NULL;

CREATE INDEX "OrderItem_order_store_id_idx" ON "OrderItem"("order_store_id");

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_order_store_id_fkey"
    FOREIGN KEY ("order_id", "order_store_id") REFERENCES "OrderStore"("order_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 10. Audit coverage for the new tables, matching "Order" and "OrderItem"
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_order_store_audit ON "OrderStore";
CREATE TRIGGER trg_order_store_audit AFTER UPDATE OR DELETE ON "OrderStore"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_invoice_audit ON "Invoice";
CREATE TRIGGER trg_invoice_audit AFTER UPDATE OR DELETE ON "Invoice"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
