-- AlterTable AuditLog
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'AuditLog' AND column_name = 'user_name'
  ) THEN
    ALTER TABLE "AuditLog" ADD COLUMN "user_name" TEXT;
  END IF;
END $$;

-- DropForeignKey OrderChangeLog (only if exists)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderChangeLog_changed_by_fkey'
  ) THEN
    ALTER TABLE "OrderChangeLog" DROP CONSTRAINT "OrderChangeLog_changed_by_fkey";
  END IF;
END $$;

-- AlterTable OrderChangeLog
ALTER TABLE "OrderChangeLog" ALTER COLUMN "changed_by" DROP NOT NULL;

-- AddForeignKey OrderChangeLog (with ON DELETE SET NULL)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderChangeLog_changed_by_fkey'
  ) THEN
    ALTER TABLE "OrderChangeLog" 
      ADD CONSTRAINT "OrderChangeLog_changed_by_fkey" 
      FOREIGN KEY ("changed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_audit_row() RETURNS TRIGGER AS $$
DECLARE v_user_id INTEGER;
DECLARE v_user_name TEXT;
BEGIN
  v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
  
  IF v_user_id IS NOT NULL THEN
    SELECT name INTO v_user_name FROM "User" WHERE id = v_user_id;
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO "AuditLog"("table_name", "record_id", "action", "changed_by", "user_name", "old_data", "new_data")
    VALUES (TG_TABLE_NAME, OLD.id, 'UPDATE', v_user_id, v_user_name, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO "AuditLog"("table_name", "record_id", "action", "changed_by", "user_name", "old_data", "new_data")
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', v_user_id, v_user_name, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
