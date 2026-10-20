-- Phase B of the work-allocation / payment-request portals.
--
-- Adds the Cost Control Manager and the three field-staff roles, an employee code on
-- users, and the CSM code / area / vehicle masters the allocation portal is built on.
-- Purely additive: no existing column or row changes.
--
-- ALTER TYPE ... ADD VALUE runs inside the migration transaction on PostgreSQL 12+; the
-- new values are not used anywhere in this file, which is what that requires.

-- CreateEnum
CREATE TYPE "CsmCodeKind" AS ENUM ('CSM', 'TEAM', 'BRANCH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AreaLocality" AS ENUM ('LOCAL', 'NON_LOCAL');

-- AlterEnum


ALTER TYPE "Role" ADD VALUE 'COST_CONTROL_MANAGER';
ALTER TYPE "Role" ADD VALUE 'PASTER';
ALTER TYPE "Role" ADD VALUE 'HELPER';
ALTER TYPE "Role" ADD VALUE 'DRIVER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emp_code" TEXT;

-- CreateTable
CREATE TABLE "CsmCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CsmCodeKind" NOT NULL DEFAULT 'UNKNOWN',
    "label" TEXT,
    "user_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsmCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "locality" "AreaLocality" NOT NULL,
    "district" TEXT,
    "needs_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "reg_no" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "usual_driver_id" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsmCode_code_key" ON "CsmCode"("code");

-- CreateIndex
CREATE INDEX "CsmCode_user_id_idx" ON "CsmCode"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_reg_no_key" ON "Vehicle"("reg_no");

-- CreateIndex
CREATE INDEX "Vehicle_usual_driver_id_idx" ON "Vehicle"("usual_driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_emp_code_key" ON "User"("emp_code");

-- AddForeignKey
ALTER TABLE "CsmCode" ADD CONSTRAINT "CsmCode_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_usual_driver_id_fkey" FOREIGN KEY ("usual_driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Audit the masters the same way as orders: fn_audit_row() records who changed what.
DROP TRIGGER IF EXISTS trg_csm_code_audit ON "CsmCode";
CREATE TRIGGER trg_csm_code_audit AFTER UPDATE OR DELETE ON "CsmCode"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_area_audit ON "Area";
CREATE TRIGGER trg_area_audit AFTER UPDATE OR DELETE ON "Area"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_vehicle_audit ON "Vehicle";
CREATE TRIGGER trg_vehicle_audit AFTER UPDATE OR DELETE ON "Vehicle"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
