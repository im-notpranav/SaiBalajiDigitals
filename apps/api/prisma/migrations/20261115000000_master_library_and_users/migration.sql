-- Master Library (2026-11-15): client codes, archive flags, name requests; permanent user delete; capital usernames.

-- CreateEnum
CREATE TYPE "MasterKind" AS ENUM ('CLIENT', 'MEDIA', 'LOCATION');

-- CreateEnum
CREATE TYPE "MasterRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "code" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MasterNameRequest" (
    "id" SERIAL NOT NULL,
    "kind" "MasterKind" NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "status" "MasterRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" INTEGER,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "final_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MasterNameRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MasterNameRequest_status_idx" ON "MasterNameRequest"("status");

-- CreateIndex
CREATE INDEX "MasterNameRequest_requested_by_idx" ON "MasterNameRequest"("requested_by");

-- CreateIndex
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

-- AddForeignKey
ALTER TABLE "MasterNameRequest" ADD CONSTRAINT "MasterNameRequest_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterNameRequest" ADD CONSTRAINT "MasterNameRequest_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Usernames are stored in capitals from now on; login ignores case (2026-11-15, Q4).
-- Stop here if two accounts differ only by case, rather than guess which one keeps the name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY upper("username") HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Two usernames differ only by case. Rename one before applying this migration.';
  END IF;
END $$;
UPDATE "User" SET "username" = upper("username") WHERE "username" <> upper("username");
ALTER TABLE "User" ADD CONSTRAINT "user_username_upper" CHECK ("username" = upper("username"));

-- Store locations become a pick-list from the Master Library "Locations" (the Area table).
-- Copy every location already used on an order, flagged for the admin to review (Q26).
-- The locality is a placeholder until the admin confirms it.
INSERT INTO "Area" ("name", "locality", "needs_confirmation", "is_active", "created_at", "updated_at")
SELECT DISTINCT ON (lower(trim(s."location"))) trim(s."location"), 'LOCAL', true, true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
FROM "OrderStore" s
WHERE trim(s."location") <> ''
  AND NOT EXISTS (SELECT 1 FROM "Area" a WHERE lower(a."name") = lower(trim(s."location")))
ORDER BY lower(trim(s."location")), trim(s."location");
