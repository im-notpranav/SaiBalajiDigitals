-- Drop the columns that duplicated store, installation and billing state on "Order".
--
-- Those facts now live on "OrderStore" and "Invoice", where an order can have many of
-- each. Everything below is derived at read time by utils/order-derive.ts.
--
-- This is irreversible: the values are only safe to drop because they were mirrors of
-- rows that still exist. The guard confirms that before anything is removed.

-- ---------------------------------------------------------------------------
-- 1. Refuse to run against data the mirrors were not fully migrated into
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_missing_store   INTEGER;
    v_orphan_items    INTEGER;
    v_lost_invoices   INTEGER;
    v_lost_payments   INTEGER;
BEGIN
    -- Every order must have at least one store, or its store name would be lost.
    SELECT COUNT(*) INTO v_missing_store
    FROM "Order" o
    WHERE NOT EXISTS (SELECT 1 FROM "OrderStore" os WHERE os."order_id" = o."id");
    IF v_missing_store > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop: % order(s) have no store row. Their store name and location would be lost.',
            v_missing_store;
    END IF;

    SELECT COUNT(*) INTO v_orphan_items FROM "OrderItem" WHERE "order_store_id" IS NULL;
    IF v_orphan_items > 0 THEN
        RAISE EXCEPTION 'Refusing to drop: % line item(s) are not attached to a store.', v_orphan_items;
    END IF;

    -- Every order that carried an invoice number must have a matching Invoice row.
    SELECT COUNT(*) INTO v_lost_invoices
    FROM "Order" o
    WHERE o."invoice_no" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."order_id" = o."id");
    IF v_lost_invoices > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop: % order(s) carry an invoice_no with no Invoice row. Billing history would be lost.',
            v_lost_invoices;
    END IF;

    -- ...and the same for a recorded payment.
    SELECT COUNT(*) INTO v_lost_payments
    FROM "Order" o
    WHERE o."amount_received" IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM "Invoice" i WHERE i."order_id" = o."id" AND i."amount_received" IS NOT NULL
      );
    IF v_lost_payments > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop: % order(s) record a payment that no Invoice carries.',
            v_lost_payments;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the foreign keys and the index that only these columns needed
-- ---------------------------------------------------------------------------
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_installed_by_fkey";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_payment_received_by_fkey";
DROP INDEX IF EXISTS "Order_store_name_idx";

-- ---------------------------------------------------------------------------
-- 3. Drop the columns
-- ---------------------------------------------------------------------------
ALTER TABLE "Order"
    DROP COLUMN "store_name",
    DROP COLUMN "location",
    DROP COLUMN "invoice_no",
    DROP COLUMN "bill_amount",
    DROP COLUMN "billing_date",
    DROP COLUMN "billing_completed_at",
    DROP COLUMN "amount_received",
    DROP COLUMN "payment_received_at",
    DROP COLUMN "payment_received_by",
    DROP COLUMN "installed_at",
    DROP COLUMN "installed_by";
