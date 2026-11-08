-- The Notification table was first created with `prisma db push` (Phase F, 2026-07-26) and never
-- got a migration, so `20260802010000_add_notification_order_link` failed on an empty database
-- ("relation \"Notification\" does not exist"). This creates the table as Phase F defined it.
--
-- It only acts when the table is missing: databases that already have it (the old production
-- database, local copies) are left exactly as they are.
DO $$
BEGIN
  IF to_regclass('"Notification"') IS NULL THEN
    CREATE TABLE "Notification" (
        "id" SERIAL NOT NULL,
        "user_id" INTEGER NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "kind" TEXT NOT NULL DEFAULT 'info',
        "read" BOOLEAN NOT NULL DEFAULT false,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
    );

    CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
