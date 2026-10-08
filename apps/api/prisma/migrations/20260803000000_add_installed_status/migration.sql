-- Enum value must be committed before it can be referenced, so it gets its own migration.
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'Installed';
