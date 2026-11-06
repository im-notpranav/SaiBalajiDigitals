-- Work can be assigned before its order, location or details are known.
ALTER TABLE "WorkJob" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "WorkJob" ALTER COLUMN "work_details" DROP NOT NULL;
ALTER TABLE "WorkJob" ALTER COLUMN "area_id" DROP NOT NULL;
ALTER TABLE "WorkJob" ALTER COLUMN "locality" DROP NOT NULL;

-- The CSM a job is for, chosen on the form. Existing jobs take it from their code or order.
ALTER TABLE "WorkJob" ADD COLUMN "csm_user_id" INTEGER;
ALTER TABLE "WorkJob" ADD CONSTRAINT "WorkJob_csm_user_id_fkey"
    FOREIGN KEY ("csm_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WorkJob_csm_user_id_idx" ON "WorkJob"("csm_user_id");

UPDATE "WorkJob" j SET "csm_user_id" = COALESCE(
    (SELECT c."user_id" FROM "CsmCode" c WHERE c."id" = j."csm_code_id"),
    (SELECT o."created_by" FROM "Order" o
       JOIN "User" u ON u."id" = o."created_by" AND u."role" = 'CSM'
      WHERE o."id" = j."order_id")
);
