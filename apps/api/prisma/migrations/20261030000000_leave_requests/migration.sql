-- Field staff request leave; the Operation Manager approves or rejects it. Existing
-- records were entered by managers, so they count as approved by whoever entered them.

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "LeaveRecord"
    ADD COLUMN "status" "LeaveStatus" NOT NULL DEFAULT 'APPROVED',
    ADD COLUMN "decided_by" INTEGER,
    ADD COLUMN "decided_at" TIMESTAMP(3),
    ADD COLUMN "reject_reason" TEXT;

UPDATE "LeaveRecord" SET "decided_by" = "created_by", "decided_at" = "created_at";

-- CreateIndex
CREATE INDEX "LeaveRecord_status_idx" ON "LeaveRecord"("status");

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A rejected request no longer holds the days, like cancelled leave.
ALTER TABLE "LeaveRecord" DROP CONSTRAINT "LeaveRecord_no_overlap";
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, daterange("from_date", "to_date", '[]') WITH &&)
    WHERE ("cancelled_at" IS NULL AND "status" <> 'REJECTED');
