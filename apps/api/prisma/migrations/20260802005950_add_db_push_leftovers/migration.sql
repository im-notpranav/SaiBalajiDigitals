-- Columns and a table that reached the old databases through `prisma db push` and never got a
-- migration. On an empty database the chain left them out, and
-- `20261111000000_audit_user_table` then failed ("column old.is_active does not exist").
--
-- Every statement is IF NOT EXISTS, so databases that already have these are left as they are.

-- User: deactivation and last sign-in.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);

-- OrderSequence: the reserved-number lock used by Settings.
ALTER TABLE "OrderSequence" ADD COLUMN IF NOT EXISTS "is_locked" BOOLEAN NOT NULL DEFAULT false;

-- EmailRecipient: addresses a user has emailed exports to, for suggestions.
CREATE TABLE IF NOT EXISTS "EmailRecipient" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "used_by" INTEGER NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailRecipient_used_by_idx" ON "EmailRecipient"("used_by");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailRecipient_email_used_by_key" ON "EmailRecipient"("email", "used_by");
