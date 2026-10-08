-- New read-only admin role. ADD VALUE must land in its own migration, since the
-- value cannot be referenced in the same transaction that creates it.
ALTER TYPE "Role" ADD VALUE 'OPERATION_MANAGER';
