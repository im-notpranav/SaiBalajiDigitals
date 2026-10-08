-- Drop trg_restrict_order_item_updates and its function.
--
-- The trigger arrived with the same out-of-band SQL that lost the audit triggers: it
-- appears in no migration in this repository. It is both dead and unsafe.
--
-- Dead, because it gates on `app.current_user_role`, which nothing in the application
-- ever sets. current_setting(...) returns NULL, `NULL <> 'ADMIN'` is NULL rather than
-- true, so the body has never executed.
--
-- Unsafe, because that body references NEW.media_id, which is not a column on OrderItem
-- (the column is `media`, a text field). The first time anyone set app.current_user_role
-- — reasonably, thinking they were enabling an access rule — every non-admin line-item
-- update would start failing with a missing-column error.
--
-- The rule it was reaching for is enforced in the application, and verified there:
-- updateOrder refuses any change to a saved line item by a CSM ("Existing line items
-- cannot be edited — flag it and add a corrected line instead"), and requires an admin
-- to attach a loss remark before altering an amount ("A remark is required to adjust the
-- amount on item #N"). Dropping this trigger removes nothing that was protecting data.

DROP TRIGGER IF EXISTS trg_restrict_order_item_updates ON "OrderItem";
DROP FUNCTION IF EXISTS fn_restrict_order_item_updates();

-- The audit trigger on OrderItem must survive this.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid
        JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE NOT tg.tgisinternal AND c.relname = 'OrderItem' AND p.proname = 'fn_audit_row'
    ) THEN
        RAISE EXCEPTION 'trg_order_item_audit is missing — refusing to leave OrderItem unaudited.';
    END IF;
END $$;
