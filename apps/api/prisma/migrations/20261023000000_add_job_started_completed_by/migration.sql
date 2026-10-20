-- AlterTable
ALTER TABLE "WorkJob" ADD COLUMN     "completed_by" INTEGER,
ADD COLUMN     "completion_note" TEXT,
ADD COLUMN     "started_by" INTEGER;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

