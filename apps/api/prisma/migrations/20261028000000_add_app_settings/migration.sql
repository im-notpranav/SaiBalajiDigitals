-- CreateTable
CREATE TABLE "AppSetting" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,63}$');

-- Changes to settings are audited like the rest of the business data.
DROP TRIGGER IF EXISTS trg_app_setting_audit ON "AppSetting";
CREATE TRIGGER trg_app_setting_audit AFTER UPDATE OR DELETE ON "AppSetting"
    FOR EACH ROW EXECUTE FUNCTION fn_audit_row();
