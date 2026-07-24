import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_portal/admin/financial-year")({
  head: () => ({ meta: [{ title: "Financial Year Config — SB OMS" }] }),
  component: () => (
    <>
      <PageHeader
        title="Financial Year Configuration"
        description="Define upcoming FY records and sequence starting points."
        crumbs={[{ label: "Administrator" }, { label: "Financial Year" }]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface-panel p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Existing records</div>
          <ul className="mt-3 space-y-2">
            {[
              { fy: "FY 2024-25", range: "01 May 2024 → 30 Apr 2025", prefix: "ORD24", status: "Closed" },
              { fy: "FY 2025-26", range: "01 May 2025 → 30 Apr 2026", prefix: "ORD25", status: "Closed" },
              { fy: "FY 2026-27", range: "01 May 2026 → 30 Apr 2027", prefix: "ORD26", status: "Active" },
            ].map((r) => (
              <li key={r.fy} className="flex items-center justify-between rounded-lg border bg-background p-3">
                <div>
                  <div className="font-semibold">{r.fy}</div>
                  <div className="text-xs text-muted-foreground">{r.range}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs">{r.prefix}</div>
                  <div className={`text-[11px] font-semibold ${r.status === "Active" ? "text-success" : "text-muted-foreground"}`}>{r.status}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="surface-panel p-6">
          <div className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">New FY record</div>
          <div className="grid gap-3">
            <div><Label>FY label</Label><Input placeholder="FY 2027-28" className="mt-1.5" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="date" className="mt-1.5" /></div>
              <div><Label>End</Label><Input type="date" className="mt-1.5" /></div>
            </div>
            <div><Label>Sequence prefix</Label><Input placeholder="ORD27" className="mt-1.5" /></div>
            <div><Label>Sequence start</Label><Input type="number" defaultValue={1000} className="mt-1.5" /></div>
            <Button className="mt-2 rounded-xl" onClick={() => toast.success("FY record staged")}>
              <Plus className="mr-2 h-4 w-4" /> Create FY record
            </Button>
          </div>
        </div>
      </div>
    </>
  ),
});
