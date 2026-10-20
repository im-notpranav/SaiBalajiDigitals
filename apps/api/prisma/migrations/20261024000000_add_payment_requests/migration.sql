-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('ADMIN_REVIEW', 'CCM_REVIEW', 'INFO_REQUESTED', 'PAYMENT_PENDING', 'PAID', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRoute" AS ENUM ('ADMIN_THEN_CCM', 'CCM_ONLY');

-- CreateEnum
CREATE TYPE "PaymentCategory" AS ENUM ('TRAVEL', 'MATERIAL', 'LABOUR', 'FOOD', 'ADVANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'RESUBMIT', 'CANCEL', 'MARK_PAID', 'CLOSE');

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" SERIAL NOT NULL,
    "request_no" TEXT NOT NULL,
    "order_id" INTEGER NOT NULL,
    "work_job_id" INTEGER,
    "requested_by" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "upi_id" TEXT NOT NULL,
    "category" "PaymentCategory",
    "purpose" TEXT NOT NULL,
    "remarks" TEXT,
    "bill_details_required" BOOLEAN NOT NULL,
    "route" "PaymentRoute" NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL,
    "returned_from" "PaymentRequestStatus",
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_amount" DECIMAL(10,2),
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "paid_by" INTEGER,
    "closed_at" TIMESTAMP(3),
    "closed_by" INTEGER,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestEvent" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "action" "PaymentAction" NOT NULL,
    "from_status" "PaymentRequestStatus",
    "to_status" "PaymentRequestStatus" NOT NULL,
    "actor_id" INTEGER,
    "actor_role" "Role" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_request_no_key" ON "PaymentRequest"("request_no");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_idempotency_key_key" ON "PaymentRequest"("idempotency_key");

-- CreateIndex
CREATE INDEX "PaymentRequest_order_id_idx" ON "PaymentRequest"("order_id");

-- CreateIndex
CREATE INDEX "PaymentRequest_requested_by_idx" ON "PaymentRequest"("requested_by");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

-- CreateIndex
CREATE INDEX "PaymentRequestEvent_request_id_idx" ON "PaymentRequestEvent"("request_id");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_work_job_id_fkey" FOREIGN KEY ("work_job_id") REFERENCES "WorkJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestEvent" ADD CONSTRAINT "PaymentRequestEvent_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestEvent" ADD CONSTRAINT "PaymentRequestEvent_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;




-- request_no is PR-YYMM-NNNN; the number runs on across months and is minted by the API.
CREATE SEQUENCE IF NOT EXISTS payment_request_no_seq;

ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_amount_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_amount_check"
    CHECK ("paid_amount" IS NULL OR ("paid_amount" > 0 AND "paid_amount" <= "amount"));
-- The route is fixed by the bill toggle at submission.
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_route_check"
    CHECK (("route" = 'CCM_ONLY') = "bill_details_required");
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_returned_check"
    CHECK ("status" <> 'INFO_REQUESTED' OR "returned_from" IN ('ADMIN_REVIEW', 'CCM_REVIEW'));
-- A paid or closed request always carries its payment record.
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paid_check"
    CHECK ("status" NOT IN ('PAID', 'CLOSED')
           OR ("paid_at" IS NOT NULL AND "paid_amount" IS NOT NULL AND "payment_reference" IS NOT NULL));

DROP TRIGGER IF EXISTS trg_payment_request_audit ON "PaymentRequest";
CREATE TRIGGER trg_payment_request_audit AFTER UPDATE OR DELETE ON "PaymentRequest"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

-- The history is append-only.
CREATE OR REPLACE FUNCTION fn_payment_event_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'PaymentRequestEvent rows cannot be changed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_event_immutable ON "PaymentRequestEvent";
CREATE TRIGGER trg_payment_event_immutable BEFORE UPDATE ON "PaymentRequestEvent"
    FOR EACH ROW EXECUTE FUNCTION fn_payment_event_immutable();
