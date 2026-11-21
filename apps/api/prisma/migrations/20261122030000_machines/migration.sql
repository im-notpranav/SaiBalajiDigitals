-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "default_machine_id" INTEGER;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "machine_id" INTEGER,
ADD COLUMN     "started_at" TIMESTAMP(3),
ADD COLUMN     "started_by" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "machine_id" INTEGER;

-- CreateTable
CREATE TABLE "Machine" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Machine_name_key" ON "Machine"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_default_machine_id_fkey" FOREIGN KEY ("default_machine_id") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The six machines.
INSERT INTO "Machine" ("name", "sort_order") VALUES
  ('CNC', 1), ('Epson', 2), ('Solvent', 3), ('UV Machine', 4), ('Outward', 5), ('Order Sheet', 6)
ON CONFLICT ("name") DO NOTHING;

-- A new line, or a line whose line item changes, takes the line item's default machine unless
-- one was given. Every path that writes lines (forms, bulk upload, approved requests) gets it.
CREATE OR REPLACE FUNCTION order_item_default_machine() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.machine_id IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.media IS DISTINCT FROM OLD.media AND NEW.machine_id IS NOT DISTINCT FROM OLD.machine_id) THEN
    SELECT m.default_machine_id INTO NEW.machine_id
      FROM "Media" m WHERE lower(m.name) = lower(NEW.media) LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS order_item_default_machine ON "OrderItem";
CREATE TRIGGER order_item_default_machine
  BEFORE INSERT OR UPDATE OF media ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION order_item_default_machine();
