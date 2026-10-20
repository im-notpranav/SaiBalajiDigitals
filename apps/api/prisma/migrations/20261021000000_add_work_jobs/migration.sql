-- Phase C: field work jobs.
--
-- A WorkJob is one team sent to work on an order between two dates. WorkJobMember holds
-- the people on it, with the job's dates copied so that an exclusion constraint can make
-- the database itself refuse to put one person on two overlapping jobs, even when two
-- managers save at the same moment. Cancelled jobs and jobs marked "Allow 2nd job" set
-- blocks_calendar = false and drop out of the constraint.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Job numbers W00001, W00002 … (the WorkJob.job_no default reads this sequence).
CREATE SEQUENCE IF NOT EXISTS work_job_no_seq;

-- CreateEnum
CREATE TYPE "WorkJobStatus" AS ENUM ('ASSIGNED', 'STARTED', 'COMPLETED', 'HOLD', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkJob" (
    "id" SERIAL NOT NULL,
    "job_no" TEXT NOT NULL DEFAULT ('W'::text || lpad((nextval('work_job_no_seq'::regclass))::text, 5, '0'::text)),
    "order_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "csm_code_id" INTEGER,
    "csm2_code_id" INTEGER,
    "work_details" TEXT NOT NULL,
    "area_id" INTEGER NOT NULL,
    "locality" "AreaLocality" NOT NULL,
    "vehicle_id" INTEGER,
    "route" TEXT,
    "extra_tag" TEXT,
    "instructions" TEXT,
    "allow_double_booking" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkJobStatus" NOT NULL DEFAULT 'ASSIGNED',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkJobMember" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "slot_role" "Role" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "blocks_calendar" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WorkJobMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkJobStore" (
    "job_id" INTEGER NOT NULL,
    "order_store_id" INTEGER NOT NULL,

    CONSTRAINT "WorkJobStore_pkey" PRIMARY KEY ("job_id","order_store_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkJob_job_no_key" ON "WorkJob"("job_no");

-- CreateIndex
CREATE INDEX "WorkJob_order_id_idx" ON "WorkJob"("order_id");

-- CreateIndex
CREATE INDEX "WorkJob_start_date_end_date_idx" ON "WorkJob"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "WorkJob_status_idx" ON "WorkJob"("status");

-- CreateIndex
CREATE INDEX "WorkJobMember_user_id_start_date_idx" ON "WorkJobMember"("user_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkJobMember_job_id_user_id_key" ON "WorkJobMember"("job_id", "user_id");

-- CreateIndex
CREATE INDEX "WorkJobStore_order_store_id_idx" ON "WorkJobStore"("order_store_id");

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_csm_code_id_fkey" FOREIGN KEY ("csm_code_id") REFERENCES "CsmCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_csm2_code_id_fkey" FOREIGN KEY ("csm2_code_id") REFERENCES "CsmCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "WorkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJobStore" ADD CONSTRAINT "WorkJobStore_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "WorkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJobStore" ADD CONSTRAINT "WorkJobStore_order_store_id_fkey" FOREIGN KEY ("order_store_id") REFERENCES "OrderStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The sequence belongs to the column: dropping the table drops it too.
ALTER SEQUENCE work_job_no_seq OWNED BY "WorkJob"."job_no";

ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_slot_role_check"
    CHECK ("slot_role" IN ('PASTER', 'HELPER', 'DRIVER'));

-- One person, one job per day, unless a job explicitly allows a second job.
ALTER TABLE "WorkJobMember" ADD CONSTRAINT "WorkJobMember_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&)
    WHERE ("blocks_calendar");

DROP TRIGGER IF EXISTS trg_work_job_audit ON "WorkJob";
CREATE TRIGGER trg_work_job_audit AFTER UPDATE OR DELETE ON "WorkJob"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_work_job_member_audit ON "WorkJobMember";
CREATE TRIGGER trg_work_job_member_audit AFTER UPDATE OR DELETE ON "WorkJobMember"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
