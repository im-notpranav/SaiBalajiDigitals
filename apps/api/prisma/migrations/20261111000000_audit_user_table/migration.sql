-- Audit the User table (F16). The generic fn_audit_row() snapshots the whole row, which would
-- copy the bcrypt password hash into AuditLog; this variant strips the "password" key from the
-- JSON so hashes never land in the log. Login-only updates (last_login_at) are skipped via the
-- UPDATE trigger's WHEN clause, so routine logins don't flood the audit trail — only changes to
-- role, active state, super-admin, username or the password are recorded.
CREATE OR REPLACE FUNCTION fn_audit_user_row() RETURNS TRIGGER AS $$
DECLARE v_user_id INTEGER;
DECLARE v_user_name TEXT;
BEGIN
  v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
  IF v_user_id IS NOT NULL THEN
    SELECT name INTO v_user_name FROM "User" WHERE id = v_user_id;
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO "AuditLog"("table_name", "record_id", "action", "changed_by", "user_name", "old_data", "new_data")
    VALUES (TG_TABLE_NAME, OLD.id, 'UPDATE', v_user_id, v_user_name, to_jsonb(OLD) - 'password', to_jsonb(NEW) - 'password');
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO "AuditLog"("table_name", "record_id", "action", "changed_by", "user_name", "old_data", "new_data")
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', v_user_id, v_user_name, to_jsonb(OLD) - 'password', NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_audit_update ON "User";
CREATE TRIGGER trg_user_audit_update
  AFTER UPDATE ON "User"
  FOR EACH ROW
  WHEN (
    OLD.role IS DISTINCT FROM NEW.role
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.is_super_admin IS DISTINCT FROM NEW.is_super_admin
    OR OLD.username IS DISTINCT FROM NEW.username
    OR OLD.password IS DISTINCT FROM NEW.password
  )
  EXECUTE FUNCTION fn_audit_user_row();

DROP TRIGGER IF EXISTS trg_user_audit_delete ON "User";
CREATE TRIGGER trg_user_audit_delete
  AFTER DELETE ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION fn_audit_user_row();
