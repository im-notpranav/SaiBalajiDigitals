-- CreateTable
CREATE TABLE "DaySheetEntry" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "activity" TEXT NOT NULL DEFAULT 'Note',
    "client_name" TEXT,
    "note" TEXT NOT NULL,
    "time" TEXT,
    "order_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DaySheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DaySheetEntry_user_id_day_idx" ON "DaySheetEntry"("user_id", "day");

-- AddForeignKey
ALTER TABLE "DaySheetEntry" ADD CONSTRAINT "DaySheetEntry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

