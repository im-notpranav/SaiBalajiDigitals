-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photo_url" TEXT;

-- Enforce at most one super admin at the DB layer
CREATE UNIQUE INDEX idx_single_super_admin
  ON "User" ((is_super_admin))
  WHERE is_super_admin = TRUE;

-- Grandfather in the original admin account as super admin
UPDATE "User"
SET is_super_admin = TRUE
WHERE id = (SELECT id FROM "User" WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1);
