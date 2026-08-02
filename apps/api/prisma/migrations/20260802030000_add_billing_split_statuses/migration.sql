-- Enum values must be committed before they can be referenced, so the billing-split
-- statuses land in their own migration ahead of the columns that use them.
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'BillingCompleted';
ALTER TYPE "OrderStatus" ADD VALUE 'PaymentReceived';
