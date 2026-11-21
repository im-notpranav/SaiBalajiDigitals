-- CreateEnum
CREATE TYPE "RateCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "rate_requested" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "media_id" INTEGER NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "status" "RateCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "created_by" INTEGER,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateCard_client_id_media_id_effective_from_idx" ON "RateCard"("client_id", "media_id", "effective_from");

-- CreateIndex
CREATE INDEX "RateCard_status_idx" ON "RateCard"("status");

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

