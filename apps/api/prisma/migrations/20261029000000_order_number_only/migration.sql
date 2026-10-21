-- One business number per order. Field jobs and payment requests are referred to by their
-- order's number (ORD{YY}{NNNN}) from now on, so they stop minting numbers of their own.
-- The W00001 and PR-YYMM-0001 numbers already issued stay on their rows (still unique,
-- still searchable) so nothing that quoted one is lost; new rows leave the column empty.
ALTER TABLE "WorkJob" ALTER COLUMN "job_no" DROP DEFAULT;
ALTER TABLE "WorkJob" ALTER COLUMN "job_no" DROP NOT NULL;
ALTER TABLE "PaymentRequest" ALTER COLUMN "request_no" DROP NOT NULL;

-- A requester is paid either to a UPI ID (name@bank) or to a UPI-linked mobile number.
-- upi_id holds whichever one was given; every request so far gave a UPI ID.
CREATE TYPE "PaymentUpiMethod" AS ENUM ('UPI_ID', 'MOBILE');
ALTER TABLE "PaymentRequest" ADD COLUMN "upi_method" "PaymentUpiMethod" NOT NULL DEFAULT 'UPI_ID';
