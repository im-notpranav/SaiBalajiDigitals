-- Role rename (Phase 8). RENAME VALUE rewrites the enum in place, so existing
-- user rows keep their role with no data migration:
--   EMPLOYEE -> CSM (Client Service Manager)
--   OPERATOR -> PRODUCTION_MANAGER
ALTER TYPE "Role" RENAME VALUE 'EMPLOYEE' TO 'CSM';
ALTER TYPE "Role" RENAME VALUE 'OPERATOR' TO 'PRODUCTION_MANAGER';
