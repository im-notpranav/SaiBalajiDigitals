import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarClock, RotateCw, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_portal/accountant/financial-year")({
  head: () => ({ meta: [{ title: "Financial Year — SB OMS" }] }),
  component: FinancialYearPage,
});

function FinancialYearPage() {
  return (
    <>
      <PageHeader
        title="Financial Year"
        description="View the active FY, sequence position and rollover schedule."
        crumbs={[{ label: "Accountant" }, { label: "Financial Year" }]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="surface-panel overflow-hidden lg:col-span-2">
          <div className="border-b bg-gradient-to-br from-primary/10 via-transparent to-brand-orange/10 p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Active Financial Year</div>
            <div className="mt-1 flex items-end gap-3">
              <div className="text-3xl font-bold">FY 2026-27</div>
              <span className="mb-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Active</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">01 May 2026 → 30 Apr 2027</div>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <Info label="Sequence prefix" value="ORD26" />
            <Info label="Current sequence" value="ORD261042" />
            <Info label="Total issued this FY" value="42 orders" />
            <Info label="Last rollover" value="01 May 2026 · success" />
            <Info label="Next rollover" value="01 May 2027" />
            <Info label="Rollover cron" value="pg_cron · nightly UTC 18:30" />
          </div>
        </div>

        <div className="surface-panel space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4" /> Manual rollover
          </div>
          <p className="text-xs text-muted-foreground">
            Trigger rollover ahead of schedule. This resets the sequence for the new FY and is irreversible.
          </p>
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            <ShieldAlert className="mb-1 inline h-3.5 w-3.5" /> Requires Accountant/Admin role. Audit-logged.
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="w-full rounded-xl">
                <RotateCw className="mr-2 h-4 w-4" /> Trigger rollover now
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rollover to next FY?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action is irreversible and will start a new sequence for FY 2027-28.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => toast.success("Rollover queued")}>Rollover</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
