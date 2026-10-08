import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { fetchOrder, markOrderInstalled, getFollowUps, createFollowUp } from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, PackageCheck, CheckCircle2, MessageSquarePlus, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { formatDistanceToNow } from "date-fns";
import type { OrderItem } from "@sb-oms/shared-types";
import { billingRollup, installedAt } from "@/lib/stores";

export const Route = createFileRoute("/_portal/employee/orders_/$id")({
  head: () => ({ meta: [{ title: "Order Details — SB OMS" }] }),
  component: OrderDetailEmployee,
});

function OrderDetailEmployee() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [followUpNote, setFollowUpNote] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", id],
    queryFn: () => fetchOrder(Number(id)),
  });

  const installMutation = useMutation({
    mutationFn: () => markOrderInstalled(Number(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Installation confirmed", { description: "The order is now ready for billing." });
    },
    onError: (err: any) =>
      toast.error("Couldn't mark installed", { description: err?.response?.data?.message || err.message }),
  });

  // Declared before the early returns below: a hook that only runs on the loaded path
  // changes the hook count between renders and tears the component down.
  const { data: followUps = [] } = useQuery({
    queryKey: ["follow-ups", id],
    queryFn: () => getFollowUps(Number(id)),
    enabled: !!(data?.order && billingRollup(data.order).billing_completed_at),
  });

  const followUpMutation = useMutation({
    mutationFn: (note: string) => createFollowUp(Number(id), note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups", id] });
      setFollowUpNote("");
      toast.success("Follow-up note added");
    },
    onError: (err: any) =>
      toast.error("Failed to add note", { description: err?.response?.data?.message || err.message }),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
  }
  if (error || !data?.order) {
    return <div className="p-8 text-destructive">Failed to load order.</div>;
  }

  const order = data.order;

  const items = order.items ?? [];
  const assignedItems = items.filter((i: OrderItem) => (i.assignments?.length ?? 0) > 0);
  const hasProduction = assignedItems.length > 0;
  const allProduced = hasProduction && assignedItems.every((i: OrderItem) => i.production_completed);

  // Installation is the employee's hand-off to billing — only for produced orders.
  // A multi-store order is installed store by store, from the store headings above.
  const storeCount = order.stores?.length ?? 1;
  const lastInstalledAt = installedAt(order);
  const canInstall = hasProduction && allProduced && order.status === "Active" && storeCount <= 1;

  const actions =
    order.status === "Installed" ? (
      <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-sm">
        <div className="flex items-center gap-2 font-semibold text-success">
          <CheckCircle2 className="h-5 w-5" /> Installation confirmed
        </div>
        <p className="mt-1 text-muted-foreground">
          Sent to accounts for billing{lastInstalledAt ? ` on ${new Date(lastInstalledAt).toLocaleDateString("en-IN")}` : ""}.
        </p>
      </div>
    ) : canInstall ? (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-6">
        <h3 className="mb-1 text-lg font-semibold flex items-center gap-2">
          <PackageCheck className="h-5 w-5 text-primary" /> Confirm Installation
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          All production is complete. Confirm the order has been installed to send it to accounts for billing.
        </p>
        <Button onClick={() => installMutation.mutate()} disabled={installMutation.isPending}>
          {installMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Mark as Installed
        </Button>
      </div>
    ) : hasProduction && order.status === "Active" && storeCount > 1 ? (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        This order covers {storeCount} stores. Confirm each one from its heading above as it goes in —
        accounts is told once the last store is installed.
      </div>
    ) : hasProduction && order.status === "Active" ? (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        Installation can be confirmed once all assigned items are produced.
      </div>
    ) : null;

  const followUpSection = billingRollup(order).billing_completed_at ? (
    <div className="rounded-xl border bg-card p-6">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <MessageSquarePlus className="h-4 w-4 text-primary" /> Payment Follow-Up Notes
      </h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!followUpNote.trim()) return;
          followUpMutation.mutate(followUpNote.trim());
        }}
        className="mb-4 flex gap-3"
      >
        <Textarea
          placeholder="Add a follow-up note..."
          rows={2}
          value={followUpNote}
          onChange={(e) => setFollowUpNote(e.target.value)}
          className="flex-1 resize-none"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!followUpNote.trim() || followUpMutation.isPending}
          className="self-end"
        >
          {followUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </Button>
      </form>
      {followUps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No follow-up notes yet.</p>
      ) : (
        <div className="space-y-3">
          {followUps.map((fu: any) => (
            <div key={fu.id} className="flex gap-3 border-l-2 border-primary/20 pl-4">
              <div className="flex-1">
                <p className="text-sm text-foreground">{fu.note}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(fu.created_at), { addSuffix: true })}
                  {fu.author && (
                    <>
                      <span>·</span>
                      <span className="font-medium">{fu.author.name}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        title={`Order ${order.order_no}`}
        description="Full order details and line items."
        crumbs={[{ label: "Employee" }, { label: "Orders", to: "/employee/orders" }, { label: "Details" }]}
      />
      <OrderDetail order={order} userRole={user?.role} currentUserId={user?.id} actions={<>{actions}{followUpSection}</>} />
    </>
  );
}
