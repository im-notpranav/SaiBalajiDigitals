-- Restore the audit triggers on "Order" and "OrderItem".
--
-- 20260724121011_audit_triggers created trg_order_audit and trg_order_item_audit, but
-- neither exists in the database any more: something applied out of band dropped and
-- recreated the tables, and a dropped table takes its triggers with it. The application
-- has kept setting app.current_user_id on every write throughout, so the setting was
-- being read by nothing for these two tables and the audit trail simply stopped.
--
-- Idempotent, and safe to re-run: it only adds triggers, and DROP ... IF EXISTS first so
-- a database that does still have them ends up in the same state.

-- ---------------------------------------------------------------------------
-- 1. The trigger function must already exist, at the version that records user_name
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_row') THEN
        RAISE EXCEPTION 'fn_audit_row() is missing — 20260724121011_audit_triggers has not been applied.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_audit_row' AND prosrc LIKE '%user_name%') THEN
        RAISE EXCEPTION 'fn_audit_row() predates the user_name column — apply 20260726170000_audit_log_fix first.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Recreate the two triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_order_audit ON "Order";
CREATE TRIGGER trg_order_audit AFTER UPDATE OR DELETE ON "Order"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_order_item_audit ON "OrderItem";
CREATE TRIGGER trg_order_item_audit AFTER UPDATE OR DELETE ON "OrderItem"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

-- ---------------------------------------------------------------------------
-- 3. Confirm all four audited tables are covered before finishing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_missing TEXT;
BEGIN
    SELECT string_agg(t.tbl, ', ') INTO v_missing
    FROM (VALUES ('Order'), ('OrderItem'), ('OrderStore'), ('Invoice')) AS t(tbl)
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE NOT tg.tgisinternal AND p.proname = 'fn_audit_row' AND c.relname = t.tbl
    );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Audit trigger still missing on: %', v_missing;
    END IF;
END $$;
