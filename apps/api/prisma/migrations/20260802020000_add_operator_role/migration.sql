-- Adding an enum value must be committed before it can be referenced, so this
-- lives in its own migration ahead of the assignment columns.
-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'OPERATOR';
