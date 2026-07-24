import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
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
import { ORDERS, inr, type Order } from "@/lib/mock-data";
import { Receipt } from "lucide-react";

export const Route = createFileRoute("/_portal/accountant/billing")({
  head: () => ({ meta: [{ title: "Billing Queue — SB OMS" }] }),
  component: BillingQueue,
});

function BillingQueue() {
  const [target, setTarget] = useState<Order | null>(null);
  const queue = ORDERS.filter((o) => o.status === "ready_to_bill");
  const total = queue.reduce((s, o) => s + o.total, 0);

  const confirm = () => {
    if (!target) return;
    toast.success(`${target.number} marked as billed`, {
      description: "Server transitioned status via billing trigger.",
    });
    setTarget(null);
  };

  return (
    <>
      <PageHeader
        title="Billing Queue"
        description="All orders across employees that have reached 'Ready to Bill'."
        crumbs={[{ label: "Accountant" }, { label: "Billing" }]}
        actions={
          <div className="rounded-xl border bg-primary/5 px-4 py-2 text-sm">
            <span className="text-muted-foreground">Queue value:</span>{" "}
            <span className="font-semibold text-primary">{inr(total)}</span>
          </div>
        }
      />

      <OrdersTable
        orders={queue}
        showCreator
        action={(o) => (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" className="rounded-lg" onClick={() => setTarget(o)}>
                <Receipt className="mr-1 h-3.5 w-3.5" /> Mark billed
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark {target?.number} as billed?</AlertDialogTitle>
                <AlertDialogDescription>
                  This calls the billing action on the backend. The status trigger will transition the order and this
                  action is recorded in the audit log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setTarget(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirm}>Confirm billing</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      />
    </>
  );
}
