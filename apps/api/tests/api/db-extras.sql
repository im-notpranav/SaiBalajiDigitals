-- Database rules that schema.prisma cannot express, applied to the test database after
-- `prisma db push`. Copied from the migrations named on each block; keep them in step when a
-- migration adds or changes one. (The migration history itself cannot be replayed onto an
-- empty database: "Notification" and "EmailRecipient" were created by `db push`, never by a
-- migration.)

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 20260726170000_audit_log_fix
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

-- Audit triggers: 20260904000200, 20260904000000, 20261020000000, 20261021000000,
-- 20261022000000, 20261024000000, 20261025000000, 20261028000000
CREATE TRIGGER trg_order_audit AFTER UPDATE OR DELETE ON "Order" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_order_item_audit AFTER UPDATE OR DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_order_store_audit AFTER UPDATE OR DELETE ON "OrderStore" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_invoice_audit AFTER UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_csm_code_audit AFTER UPDATE OR DELETE ON "CsmCode" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_area_audit AFTER UPDATE OR DELETE ON "Area" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_vehicle_audit AFTER UPDATE OR DELETE ON "Vehicle" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_work_job_audit AFTER UPDATE OR DELETE ON "WorkJob" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_work_job_member_audit AFTER UPDATE OR DELETE ON "WorkJobMember" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_leave_record_audit AFTER UPDATE OR DELETE ON "LeaveRecord" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_overtime_entry_audit AFTER UPDATE OR DELETE ON "OvertimeEntry" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_payment_request_audit AFTER UPDATE OR DELETE ON "PaymentRequest" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_payment_attachment_audit AFTER UPDATE OR DELETE ON "PaymentAttachment" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
CREATE TRIGGER trg_app_setting_audit AFTER UPDATE OR DELETE ON "AppSetting" FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

-- 20261021000000_add_work_jobs
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_slot_role_check"
    CHECK ("slot_role" IN ('PASTER', 'HELPER', 'DRIVER'));
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&)
    WHERE ("blocks_calendar");

-- 20261022000000_add_leave_and_overtime, 20261030000000_leave_requests
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_dates_check" CHECK ("to_date" >= "from_date");
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, daterange("from_date", "to_date", '[]') WITH &&)
    WHERE ("cancelled_at" IS NULL AND "status" <> 'REJECTED');
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_minutes_check" CHECK ("minutes" > 0 AND "minutes" < 1440);
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_times_check"
    CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, int4range("start_minute", "start_minute" + "minutes") WITH &&)
    WHERE ("status" <> 'REJECTED');

-- 20261024000000_add_payment_requests
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_amount_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_amount_check"
    CHECK ("paid_amount" IS NULL OR ("paid_amount" > 0 AND "paid_amount" <= "amount"));
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_route_check"
    CHECK (("route" = 'CCM_ONLY') = "bill_details_required");
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_returned_check"
    CHECK ("status" <> 'INFO_REQUESTED' OR "returned_from" IN ('ADMIN_REVIEW', 'CCM_REVIEW'));
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_check"
    CHECK ("status" NOT IN ('PAID', 'CLOSED')
           OR ("paid_at" IS NOT NULL AND "paid_amount" IS NOT NULL AND "payment_reference" IS NOT NULL));
CREATE OR REPLACE FUNCTION fn_payment_event_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PaymentRequestEvent rows cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_event_immutable BEFORE UPDATE ON "PaymentRequestEvent"
    FOR EACH ROW EXECUTE FUNCTION fn_payment_event_immutable();

-- 20261025000000_add_payment_attachments
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880);
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_mime_check"
    CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'));
ALTER TABLE "PaymentAttachment" ADD CONSTRAINT "PaymentAttachment_no_duplicate"
    EXCLUDE USING btree ("request_id" WITH =, "sha256" WITH =) WHERE ("deleted_at" IS NULL);

-- 20261026000000_add_whatsapp_messages, 20261027000000_add_whatsapp_link
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_phone_check"
    CHECK ("to_phone" IS NULL OR "to_phone" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_link_check"
    CHECK ("link" IS NULL OR "link" ~ '^[a-z]+(/[0-9]+){1,2}$');

-- 20261028000000_add_app_settings
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,63}$');
