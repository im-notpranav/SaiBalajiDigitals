import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldAlert, Edit, Lock, Download, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersFilterBar, OrdersPager, parseOrdersSearch, useOrdersFilters } from "@/components/orders/OrdersListFilters";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOrders, fetchWaitingOrderCount, closeOrder, exportOrders } from "@/api/orders";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CloseRemarkFields, EMPTY_CLOSE_REMARK, closeRemarkReady, type CloseRemark } from "@/components/orders/CloseRemarkFields";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";
import type { Order } from "@sb-oms/shared-types";
import { useAuth, isReadOnlyRole } from "@/lib/auth-store";
import { EmailExportDialog } from "@/components/orders/EmailExportDialog";
import { StartOrderDialog } from "@/components/orders/StartOrderDialog";

export const Route = createFileRoute("/_portal/admin/orders")({
  head: () => ({ meta: [{ title: "Order Oversight — SB OMS" }] }),
  validateSearch: parseOrdersSearch,
  component: AdminOrders,
});

function AdminOrders() {
  const { user } = useAuth();
  const readOnly = isReadOnlyRole(user?.role);
  const queryClient = useQueryClient();
  const filters = useOrdersFilters(Route.useSearch());
  const { section, debouncedQ, params } = filters;

  const [starting, setStarting] = useState(false);
  const [closingOrder, setClosingOrder] = useState<Order | null>(null);
  const [closeRemark, setCloseRemark] = useState<CloseRemark>(EMPTY_CLOSE_REMARK);
  const canSubmitClose = closeRemarkReady(closeRemark);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["orders", "admin", params],
    queryFn: () => fetchOrders(params),
    placeholderData: keepPreviousData,
  });
  // Every open allotted order still waiting on its CSM, whatever the search: the chip's count.
  const { data: waitingCount } = useQuery({
    queryKey: ["orders", "waiting-count"],
    queryFn: fetchWaitingOrderCount,
  });

  const handleClose = async () => {
    if (!closingOrder) return;
    try {
      await closeOrder(closingOrder.id, {
        remarks: closeRemark.remarks,
        remarks_other_text: closeRemark.text.trim(),
      });
      toast.success(`Order ${closingOrder.order_no} closed (Admin Override)`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) {
      toast.error(`Failed to close ${closingOrder.order_no}`, { description: friendlyError(e) });
    } finally {
      setClosingOrder(null);
      setCloseRemark(EMPTY_CLOSE_REMARK);
    }
  };

  return (
    <>
      <PageHeader
        title="Order Oversight"
        description="Every order, every status."
        crumbs={[{ label: "Automated System" }, { label: "Orders" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {!readOnly && (
              <Button className="rounded-xl shadow-soft" onClick={() => setStarting(true)}>
                <Plus className="mr-2 h-4 w-4" /> Allot Order
              </Button>
            )}
            {section !== "all" && (
              <Button variant="outline" className="rounded-xl shadow-soft" onClick={() => exportOrders({ section })}>
                <Download className="mr-2 h-4 w-4" /> Export {section === "active" ? "Active" : "Completed"}
              </Button>
            )}
            <Button variant="secondary" className="rounded-xl shadow-soft" onClick={() => exportOrders({})}>
              <Download className="mr-2 h-4 w-4" /> Export All
            </Button>
            <EmailExportDialog section={section} q={debouncedQ || undefined} />
          </div>
        }
      />
      {!readOnly && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          <ShieldAlert className="mr-2 inline h-4 w-4" />
          <span className="font-semibold">Admin Override:</span> edits and force-closures here bypass role-restricted flows and are recorded in
          the audit log with a distinct action type.
        </div>
      )}
      
      <OrdersFilterBar
        filters={filters}
        total={data?.pagination?.total || data?.orders?.length || 0}
        shown={data?.orders?.length || 0}
        waiting={{ label: "Allotted, waiting for CSM", count: waitingCount }}
      />
      <OrdersTable
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
        orders={data?.orders || []}
        showCreator
        rowLink={(o) => ({ to: "/admin/orders/$id", params: { id: String(o.id) } })}
        emptyText={filters.search.waiting ? "No allotted order is waiting for its CSM." : undefined}
        action={(o) => (
          <div className="flex justify-end gap-2">
            <Link to="/admin/orders/$id" params={{ id: String(o.id) }} className={buttonVariants({ size: "sm", variant: "ghost" })}>
              View
            </Link>
            {!readOnly && o.status !== "Completed" && (
              <>
                <Link to="/admin/edit-order/$id" params={{ id: String(o.id) }} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  <Edit className="mr-1 h-3.5 w-3.5" /> Edit
                </Link>
                <Button size="sm" variant="destructive" onClick={() => setClosingOrder(o as Order)}>
                  <Lock className="mr-1 h-3.5 w-3.5" /> Close
                </Button>
              </>
            )}
          </div>
        )}
      />
      <OrdersPager filters={filters} total={data?.pagination?.total || 0} />

      <StartOrderDialog open={starting} onClose={() => setStarting(false)} />

      {/* Admin Force Close Modal */}
      <AlertDialog open={!!closingOrder} onOpenChange={(open) => !open && setClosingOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Close {closingOrder?.order_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              As an Administrator, you are bypassing standard workflows to terminate this order. This action is terminal and will be audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-4">
            <CloseRemarkFields value={closeRemark} onChange={setCloseRemark} idPrefix="list-close" />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClose} disabled={!canSubmitClose} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Confirm Force Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
