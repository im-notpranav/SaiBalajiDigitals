-- Allow more than one super admin (2026-11-15). The original rule (idx_single_super_admin, from
-- 20260730225100) capped it at one; a second super admin is now wanted alongside the first.
-- IF EXISTS keeps this safe to run after prisma/add-super-admin.ts has already dropped it.
DROP INDEX IF EXISTS idx_single_super_admin;
