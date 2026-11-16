import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { buttonVariants } from "@/components/ui/button";
import { Receipt, IndianRupee, Store, BellRing, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchOrders, remindInvoiceDetails } from "@/api/orders";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order } from "@sb-oms/shared-types";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_portal/accountant/billing")({
  head: () => ({ meta: [{ title: "Billing Queue — SB OMS" }] }),
  component: BillingQueue,
});

function BillingQueue() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "billing-queue"],
    queryFn: () => fetchOrders({ section: "active", limit: 100 }),
  });

  const all = data?.orders || [];
  // An order still in production/awaiting installation isn't the accountant's yet.
  const hasProduction = (o: Order) => (o.items ?? []).some((i) => (i.assignments?.length ?? 0) > 0);
  const isBillable = (o: Order) =>
    o.status === "Installed" || o.status === "Pending" || o.status === "BillingCompleted" ||
    (o.status === "Active" && !hasProduction(o));

  const queue = all.filter(isBillable);

  /** Orders ticked for "Remind CSMs". */
  const [picked, setPicked] = useState<Set<number>>(new Set());
  /** Only orders still waiting for an invoice, raised by a CSM, can be reminded about. */
  const canRemind = (o: Order) => o.status !== "BillingCompleted" && !!o.created_by;
  const pickedShown = queue.filter((o: Order) => picked.has(o.id) && canRemind(o));
  const remind = useMutation({
    mutationFn: (ids: number[]) => remindInvoiceDetails(ids),
    onSuccess: (res) => {
      const skipped = [
        res.skipped_recent > 0 ? `${res.skipped_recent} reminded in the last hour, so skipped.` : "",
        res.skipped_no_csm > 0 ? `${res.skipped_no_csm} with no CSM.` : "",
      ].filter(Boolean);
      if (res.reminded === 0) {
        toast.info("No reminder sent", { description: skipped.join(" ") || undefined });
      } else {
        toast.success(
          `Reminded ${res.csms} ${res.csms === 1 ? "CSM" : "CSMs"} about ${res.reminded} ${res.reminded === 1 ? "order" : "orders"}`,
          {
            description: [
              res.emailed === res.csms
                ? "Sent in the app and by email."
                : res.emailed === 0
                  ? "Sent in the app. No email address on file."
                  : `Sent in the app; ${res.emailed} of ${res.csms} also by email.`,
              ...skipped,
            ].join(" "),
          },
        );
      }
      setPicked(new Set());
    },
    onError: (err: any) =>
      toast.error("Could not send the reminder", { description: friendlyError(err) }),
  });
  const total = queue.reduce((s: number, o: Order) => s + (o.total_amount || 0), 0);
  const awaitingPayment = queue.filter((o: Order) => o.status === "BillingCompleted").length;
  const inProduction = all.length - queue.length;

  return (
    <>
      <PageHeader
        title="Billing Queue"
        description="Orders awaiting an invoice or a payment."
        crumbs={[{ label: "Accountant" }, { label: "Billing" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {inProduction > 0 && (
              <div className="rounded-xl border bg-muted/40 px-4 py-2 text-sm">
                <span className="text-muted-foreground">In production:</span>{" "}
                <span className="font-semibold">{inProduction}</span>
              </div>
            )}
            {awaitingPayment > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
                <span className="text-muted-foreground">Awaiting payment:</span>{" "}
                <span className="font-semibold text-primary">{awaitingPayment}</span>
              </div>
            )}
            <div className="rounded-xl border bg-primary/5 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Queue value:</span>{" "}
              <span className="font-semibold text-primary">{inr(total)}</span>
            </div>
          </div>
        }
      />
      <div className="surface-panel mb-4 flex flex-wrap items-center gap-2 p-3 text-sm">
        <BellRing className="h-4 w-4 text-primary" aria-hidden />
        {pickedShown.length > 0 ? (
          <>
            <span className="font-medium">{pickedShown.length} selected</span>
            <Button size="sm" onClick={() => remind.mutate(pickedShown.map((o: Order) => o.id))} disabled={remind.isPending}>
              {remind.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <BellRing className="mr-1.5 h-4 w-4" aria-hidden />}
              Remind {pickedShown.length === 1 ? "the CSM" : "their CSMs"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} aria-label="Clear selection">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">
            Waiting on invoice details? Tick orders and remind their CSMs, or use Remind on one row. They get it in the app and by email.
          </span>
        )}
      </div>
      <OrdersTable
        selection={{ selected: picked, onChange: setPicked, canSelect: canRemind }}
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        orders={queue}
        showCreator
        rowLink={(o) =>
          (o.store_count ?? o.stores?.length ?? 1) === 0
            ? null
            : { to: "/accountant/billing/$id", params: { id: String(o.id) } }
        }
        action={(o) => {
          const remindButton = canRemind(o) ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              disabled={remind.isPending}
              onClick={() => remind.mutate([o.id])}
              title={`Remind ${o.creator_name ?? "the CSM"} to send the invoice details`}
              aria-label={`Remind the CSM of ${o.order_no} to send invoice details`}
            >
              <BellRing className="mr-1 h-3.5 w-3.5" aria-hidden /> Remind
            </Button>
          ) : null;
          // No stores means no items either: nothing to invoice until the CSM adds them.
          if ((o.store_count ?? o.stores?.length ?? 1) === 0) {
            return (
              <span className="inline-flex items-center gap-1.5">
                {remindButton}
                <span
                  title="The CSM has to add this order's line items before it can be invoiced."
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
                >
                  <Store className="h-3.5 w-3.5" aria-hidden /> Needs line items
                </span>
              </span>
            );
          }
          const awaitingPay = o.status === "BillingCompleted";
          return (
            <span className="inline-flex items-center gap-1.5">
            {remindButton}
            <Link
              to="/accountant/billing/$id"
              params={{ id: String(o.id) }}
              className={buttonVariants({ variant: awaitingPay ? "secondary" : "default", size: "sm", className: cn("rounded-lg", awaitingPay && "border border-primary/40") })}
            >
              {awaitingPay ? (
                <><IndianRupee className="mr-1 h-3.5 w-3.5" /> Record Payment</>
              ) : (
                <><Receipt className="mr-1 h-3.5 w-3.5" /> Invoice Order</>
              )}
            </Link>
            </span>
          );
        }}
      />
    </>
  );
}
