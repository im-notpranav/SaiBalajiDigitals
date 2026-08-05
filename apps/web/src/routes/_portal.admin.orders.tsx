import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldAlert, Edit, Lock, Download, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersTable } from "@/components/orders/OrdersTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOrders, closeOrder, exportOrders } from "@/api/orders";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { REMARK_TYPES } from "@/lib/constants";
import { toast } from "sonner";
import type { Order, RemarkType } from "@sb-oms/shared-types";
import { useAuth, isReadOnlyRole } from "@/lib/auth-store";
import { EmailExportDialog } from "@/components/orders/EmailExportDialog";

export const Route = createFileRoute("/_portal/admin/orders")({
  head: () => ({ meta: [{ title: "Order Oversight — SB OMS" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
  }),
  component: AdminOrders,
});

function AdminOrders() {
  const { user } = useAuth();
  const readOnly = isReadOnlyRole(user?.role);
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const [section, setSection] = useState<"active" | "completed">("active");
  const [q, setQ] = useState(search.q || "");
  const [searchField, setSearchField] = useState<"client" | "store" | "order_no">("client");
  const debouncedQ = useDebounce(q, 300);

  const [closingOrder, setClosingOrder] = useState<Order | null>(null);
  const [remark, setRemark] = useState<RemarkType | "Other">(REMARK_TYPES[0]!.value);
  const [custom, setCustom] = useState("");

  const isCustom = remark === "Other";
  const canSubmitClose = !isCustom || custom.trim().length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ["orders", "admin", section, searchField, debouncedQ],
    queryFn: () => {
      const params: any = { section };
      if (debouncedQ) params[searchField] = debouncedQ;
      return fetchOrders(params);
    },
  });

  const handleClose = async () => {
    if (!closingOrder) return;
    try {
      await closeOrder(closingOrder.id, {
        remarks: remark,
        remarks_other_text: isCustom ? custom : undefined,
      });
      toast.success(`Order ${closingOrder.order_no} closed (Admin Override)`);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (e: any) {
      toast.error(`Failed to close ${closingOrder.order_no}`, { description: e.message });
    } finally {
      setClosingOrder(null);
      setCustom("");
      setRemark(REMARK_TYPES[0]!.value);
    }
  };

  return (
    <>
      <PageHeader
        title="Order Oversight"
        description="Full unfiltered view — every order, every creator, every status. Override edits generate audit entries."
        crumbs={[{ label: "Administrator" }, { label: "Orders" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl shadow-soft" onClick={() => exportOrders({ section })}>
              <Download className="mr-2 h-4 w-4" /> Export {section === "active" ? "Active" : "Completed"}
            </Button>
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
      
      <div className="surface-panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={section} onValueChange={(v) => setSection(v as "active" | "completed")} className="w-[300px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex flex-1 items-center gap-2">
          <Select value={searchField} onValueChange={(v: any) => setSearchField(v)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="client">Client Name</SelectItem>
              <SelectItem value="store">Store Name</SelectItem>
              <SelectItem value="order_no">Order No</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search by ${searchField === 'client' ? 'client name' : searchField === 'store' ? 'store name' : 'order number'}...`}
              className="pl-9"
            />
          </div>
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {data?.pagination?.total || data?.orders?.length || 0} orders found
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading orders...</div>
      ) : (
        <OrdersTable 
          orders={data?.orders || []} 
          showCreator 
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
      )}

      {/* Admin Force Close Modal */}
      <AlertDialog open={!!closingOrder} onOpenChange={(open) => !open && setClosingOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Close {closingOrder?.order_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              As an Administrator, you are bypassing standard workflows to terminate this order. This action is terminal and will be audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold">Closure remark type</label>
              <Select value={remark} onValueChange={(v) => setRemark(v as RemarkType | "Other")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REMARK_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                  <SelectItem value="Other">Other (Custom)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isCustom && (
              <div className="animate-pop-in">
                <label className="mb-1.5 block text-xs font-semibold">
                  Custom reason * <span className="text-destructive">(required)</span>
                </label>
                <Textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Explain the custom closure reason…" />
                {!custom.trim() && <p className="mt-1 text-xs text-destructive">Free-text reason is required for Custom Reason.</p>}
              </div>
            )}
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
