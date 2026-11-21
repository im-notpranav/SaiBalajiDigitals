-- Nov 17 change list, batch 1 (2026-11-22).
-- 1. Optional order-level remark the CSM can type when creating an order.
ALTER TABLE "Order" ADD COLUMN "order_remark" TEXT;

-- 2. A notes thread on every order that anyone working on it can add to.
CREATE TABLE "OrderNote" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" INTEGER,
    "author_name" TEXT NOT NULL,
    "author_role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderNote_order_id_created_at_idx" ON "OrderNote"("order_id", "created_at");
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
