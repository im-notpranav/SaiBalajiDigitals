import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PRODUCTION_REMARK_TYPES, CLOSURE_REMARK_TYPES } from "@/lib/constants";
import { toast } from "sonner";

export const Route = createFileRoute("/_portal/admin/settings")({
  head: () => ({ meta: [{ title: "System Settings — SB OMS" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <>
      <PageHeader title="System Configuration" description="Order-number sequence and reference data management." crumbs={[{ label: "Administrator" }, { label: "Settings" }]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface-panel p-6">
          <h3 className="mb-4 text-sm font-semibold">Order Number Sequence</h3>
          <div className="grid gap-3">
            <div><Label>Current prefix</Label><Input readOnly defaultValue="ORD26" className="mt-1.5 font-mono" /></div>
            <div><Label>Next number</Label><Input readOnly defaultValue="ORD261043" className="mt-1.5 font-mono" /></div>
            <div className="flex items-center justify-between rounded-lg border bg-background p-3">
              <div>
                <div className="text-sm font-semibold">Lock sequence adjustments</div>
                <div className="text-xs text-muted-foreground">Require dual approval to change.</div>
              </div>
              <Switch defaultChecked />
            </div>
            <Button variant="outline" className="rounded-xl" onClick={() => toast.info("Sequence adjustment request queued")}>
              Request sequence adjustment
            </Button>
          </div>
        </div>

        <div className="surface-panel p-6">
          <h3 className="mb-4 text-sm font-semibold">Reference data</h3>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Production remark types</div>
              <div className="flex flex-wrap gap-1.5">
                {PRODUCTION_REMARK_TYPES.map((r) => <Badge key={r.value} variant="outline">{r.label}</Badge>)}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Closure remark types</div>
              <div className="flex flex-wrap gap-1.5">
                {CLOSURE_REMARK_TYPES.map((r) => <Badge key={r.value} variant="outline">{r.label}</Badge>)}
              </div>
            </div>
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-info">
              Enum-backed values map 1:1 with Postgres enums <code className="mx-1 font-mono">remark_type</code> and{" "}
              <code className="mx-1 font-mono">closure_remark_type</code>. Changes require a DB migration.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
