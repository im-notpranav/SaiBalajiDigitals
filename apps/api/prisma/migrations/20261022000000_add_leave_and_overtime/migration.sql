-- CreateEnum
CREATE TYPE "OvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "LeaveRecord" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT,
    "created_by" INTEGER,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" INTEGER,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeEntry" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "work_job_id" INTEGER,
    "csm_code_id" INTEGER,
    "remarks" TEXT,
    "status" "OvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveRecord_user_id_from_date_idx" ON "LeaveRecord"("user_id", "from_date");

-- CreateIndex
CREATE INDEX "LeaveRecord_from_date_to_date_idx" ON "LeaveRecord"("from_date", "to_date");

-- CreateIndex
CREATE INDEX "OvertimeEntry_user_id_work_date_idx" ON "OvertimeEntry"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "OvertimeEntry_work_date_idx" ON "OvertimeEntry"("work_date");

-- CreateIndex
CREATE INDEX "OvertimeEntry_status_idx" ON "OvertimeEntry"("status");

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_work_job_id_fkey" FOREIGN KEY ("work_job_id") REFERENCES "WorkJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_csm_code_id_fkey" FOREIGN KEY ("csm_code_id") REFERENCES "CsmCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- btree_gist was created by 20261021000000_add_work_jobs; repeated so this file stands alone.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_dates_check" CHECK ("to_date" >= "from_date");

-- One person's live leave never overlaps; cancelled leave is history only.
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, daterange("from_date", "to_date", '[]') WITH &&)
    WHERE ("cancelled_at" IS NULL);

ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_minutes_check" CHECK ("minutes" > 0 AND "minutes" < 1440);
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_times_check"
    CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- One person cannot have two overlapping stretches of overtime (rejected entries excepted).
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, int4range("start_minute", "start_minute" + "minutes") WITH &&)
    WHERE ("status" <> 'REJECTED');

DROP TRIGGER IF EXISTS trg_leave_record_audit ON "LeaveRecord";
CREATE TRIGGER trg_leave_record_audit AFTER UPDATE OR DELETE ON "LeaveRecord"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_overtime_entry_audit ON "OvertimeEntry";
CREATE TRIGGER trg_overtime_entry_audit AFTER UPDATE OR DELETE ON "OvertimeEntry"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
