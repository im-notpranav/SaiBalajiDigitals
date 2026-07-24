-- CreateAuditLogTableAndTriggers
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  changed_by INTEGER,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_audit_row() RETURNS TRIGGER AS $$
DECLARE v_user_id INTEGER;
BEGIN
  v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_log(table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (TG_TABLE_NAME, OLD.id, 'UPDATE', v_user_id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_log(table_name, record_id, action, changed_by, old_data, new_data)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', v_user_id, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_audit ON "Order";
CREATE TRIGGER trg_order_audit AFTER UPDATE OR DELETE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_order_item_audit ON "OrderItem";
CREATE TRIGGER trg_order_item_audit AFTER UPDATE OR DELETE ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
