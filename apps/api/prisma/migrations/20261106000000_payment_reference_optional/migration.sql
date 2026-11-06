-- The UTR is optional when marking a request paid. A paid or closed request still carries
-- when it was paid and how much.
ALTER TABLE "PaymentRequest" DROP CONSTRAINT "PaymentRequest_paid_check";
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_check"
    CHECK ("status" NOT IN ('PAID', 'CLOSED')
           OR ("paid_at" IS NOT NULL AND "paid_amount" IS NOT NULL));
