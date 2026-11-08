-- Revokes existing sessions on a password change: see middlewares/auth.middleware.ts.
ALTER TABLE "User" ADD COLUMN "password_changed_at" TIMESTAMP(3);
