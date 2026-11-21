-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "block_orders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "contact_number" TEXT,
ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "csm_name" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "payment_block_days" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "pending_block_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "short_name" TEXT;

-- AlterTable
ALTER TABLE "MasterNameRequest" ADD COLUMN     "details" JSONB;

-- CreateTable
CREATE TABLE "OrderBlockException" (
    "id" SERIAL NOT NULL,
    "client_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MasterRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" INTEGER,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "used_at" TIMESTAMP(3),
    "used_order_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBlockException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderBlockException_status_idx" ON "OrderBlockException"("status");

-- CreateIndex
CREATE INDEX "OrderBlockException_requested_by_idx" ON "OrderBlockException"("requested_by");

