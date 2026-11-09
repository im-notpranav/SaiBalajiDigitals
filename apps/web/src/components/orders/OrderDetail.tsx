import { motion } from "framer-motion";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Flag, MessageSquare, Ban, CheckCircle2, Factory, PackageCheck, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import { inr } from "@/lib/format";
import { remarkLabel, LOSS_REMARK_TYPES, isLossRemark, isAmountRemark, remarkNeedsReason, lineBillable, NORMAL_REMARK_LABEL } from "@/lib/constants";
import type { Order, OrderItem, RemarkType } from "@sb-oms/shared-types";
import { flagOrderItem, setItemLossRemark, markStoreInstalled, updateStore, updateOrderDetails, type ItemRemarkPayload } from "@/api/orders";
import { Textarea } from "@/components/ui/textarea";
import { AdjustmentFigure, figureOf, OrderAdjustmentsPanel, RequestLineAdjustmentDialog } from "./OrderAdjustments";
import { storeRef } from "@/lib/stores";
import { useQueryClient } from "@tanstack/react-query";

export interface OrderDetailProps {
  order: Order | any;
  actions?: React.ReactNode;
  /** Other records filed under this order number (field work, payment requests), shown above the actions. */
  related?: React.ReactNode;
  userRole?: string;
  /** The signed-in user, so per-store install is offered only to the order's creator. */
  currentUserId?: number;
}

export function OrderDetail({ order, actions, related, userRole, currentUserId }: OrderDetailProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["order", order.id.toString()] });

  const isAdmin = userRole === "ADMIN";
  const isCreator = currentUserId != null && order.created_by === currentUserId;
  /** Installation is the creator's hand-off to billing (or an admin's). */
  const canInstall = order.status === "Active" && (isAdmin || (userRole === "CSM" && isCreator));
  /** Header fields stay editable until the order is settled — a PO usually arrives late. */
  const canEditHeader =
    (isAdmin || userRole === "CSM") &&
    ["Active", "Installed", "BillingCompleted", "Pending"].includes(order.status);

  const handleInstallStore = async (storeId: number, storeName: string) => {
    setIsSubmitting(true);
    try {
      await markStoreInstalled(order.id, storeId);
      toast.success(`${storeName} marked installed`);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err: any) {
      toast.error("Couldn't mark installed", { description: err?.response?.data?.message || err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStorePo = async (storeId: number, po: string) => {
    setIsSubmitting(true);
    try {
      await updateStore(order.id, storeId, { po_number: po.trim() || null });
      toast.success(po.trim() ? "Store PO saved" : "Store PO cleared");
      refresh();
    } catch (err: any) {
      toast.error("Couldn't save the PO", { description: err?.response?.data?.message || err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJobPo = async (po: string) => {
    setIsSubmitting(true);
    try {
      await updateOrderDetails(order.id, { po_number: po.trim() || null });
      toast.success(po.trim() ? "Job PO saved" : "Job PO cleared");
      refresh();
    } catch (err: any) {
      toast.error("Couldn't save the PO", { description: err?.response?.data?.message || err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFlagItem = async (itemId: number, isFlagged: boolean, reason?: string) => {
    setIsSubmitting(true);
    try {
      await flagOrderItem(order.id, itemId, isFlagged, reason);
      toast.success(isFlagged ? "Item flagged" : "Flag removed");
      queryClient.invalidateQueries({ queryKey: ["order", order.id.toString()] });
    } catch (err: any) {
      toast.error("Failed to flag item", { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectFlag = async (itemId: number) => {
    setIsSubmitting(true);
    try {
      await flagOrderItem(order.id, itemId, false);
      toast.success("Flag rejected", { description: "The employee has been notified." });
      queryClient.invalidateQueries({ queryKey: ["order", order.id.toString()] });
    } catch (err: any) {
      toast.error("Failed to reject flag", { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetRemark = async (itemId: number, payload: ItemRemarkPayload) => {
    setIsSubmitting(true);
    try {
      await setItemLossRemark(order.id, itemId, payload);
      toast.success(payload.remarks ? "Remark saved" : "Remark removed");
      queryClient.invalidateQueries({ queryKey: ["order", order.id.toString()] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err: any) {
      toast.error("Failed to set remark", { description: err?.response?.data?.message || err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasFinancials = order.items && order.items.length > 0 && order.items[0].rate !== undefined;

  const assignedItems = (order.items ?? []).filter((i: OrderItem) => (i.assignments?.length ?? 0) > 0);
  const showProduction = assignedItems.length > 0;
  const producedItems = assignedItems.filter((i: OrderItem) => i.production_completed).length;
  const allProduced = showProduction && producedItems === assignedItems.length;

  const stores: any[] = order.stores ?? [];
  const invoiceById = new Map<number, any>((order.invoices ?? []).map((i: any) => [i.id, i]));
  /** Group under store headings only when the server sent stores carrying their items. */
  const grouped = stores.length > 0 && stores.some((s) => (s.items?.length ?? 0) > 0);

  /** Flag and loss-remark badges for one item; shared by the phone list and the table. */
  const remarksFor = (item: OrderItem) => (
    <div className="space-y-1">
      {item.is_flagged && (
        <div className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Flagged
          {item.flag_reason && <span className="ml-1 font-normal opacity-80">({item.flag_reason})</span>}
        </div>
      )}
      {item.remarks && item.remarks_confirmed && (
        <div className="text-xs">
          {isLossRemark(item.remarks) ? (
            <span className="font-medium text-amber-600 dark:text-amber-500">Loss: {remarkLabel(item.remarks)}</span>
          ) : (
            <span className="font-medium text-primary">
              {remarkLabel(item.remarks)}
              {isAmountRemark(item.remarks) && ` ${item.remarks === "ExtraAmount" ? "+" : "−"}${inr(Number(item.adjustment_amount) || 0)}`}
              {item.remarks === "Revised" && item.original_amount != null && ` (was ${inr(Number(item.original_amount))})`}
            </span>
          )}
          {item.remarks_other_text && <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap max-w-[200px] truncate" title={item.remarks_other_text}>{item.remarks_other_text}</div>}
        </div>
      )}
      {item.remarks && !item.remarks_confirmed && (
        <div className="text-xs">
          <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 font-medium text-blue-600 dark:text-blue-400">
            {isAmountRemark(item.remarks)
              ? `Requested: ${remarkLabel(item.remarks)} ${inr(Number(item.adjustment_amount) || 0)}`
              : `Proposed loss: ${remarkLabel(item.remarks)}`}
          </span>
          <div className="text-muted-foreground mt-0.5">pending admin approval</div>
          {item.remarks_other_text && <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap max-w-[200px] truncate" title={item.remarks_other_text}>{item.remarks_other_text}</div>}
        </div>
      )}
      {!item.is_flagged && !item.remarks && (
        <span className="text-muted-foreground">-</span>
      )}
    </div>
  );

  const actionsFor = (item: OrderItem) => (
    <div className="flex items-center justify-end space-x-2">
      {(userRole === "CSM" || userRole === "ADMIN") && (order.status === "Active" || order.status === "Installed") && (
        <FlagDialog
          item={item}
          onSave={(flagged, reason) => handleFlagItem(item.id!, flagged, reason)}
          isSubmitting={isSubmitting}
        />
      )}
      {userRole === "ADMIN" && item.is_flagged && (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 border-destructive/40 text-destructive hover:bg-destructive/10"
          title="Reject flag"
          onClick={() => handleRejectFlag(item.id!)}
          disabled={isSubmitting}
        >
          <Ban className="h-3.5 w-3.5" />
        </Button>
      )}
      {userRole === "ADMIN" && order.status !== "Completed" && (
        <RemarkDialog
          item={item}
          onSave={(payload) => handleSetRemark(item.id!, payload)}
          isSubmitting={isSubmitting}
        />
      )}
      {userRole === "CSM" && isCreator && hasFinancials && !item.remarks && order.status !== "Completed" && (
        <RequestLineAdjustmentDialog orderId={order.id} item={item} />
      )}
    </div>
  );

  /** What the line is billed at once its remark is confirmed; proposals stay at the plain amount. */
  const billedAt = (item: OrderItem) =>
    item.remarks_confirmed ? lineBillable(Number(item.amount) || 0, item.remarks, item.adjustment_amount) : Number(item.amount) || 0;
  const AmountCell = ({ item }: { item: OrderItem }) => {
    const plain = Number(item.amount) || 0;
    const billed = billedAt(item);
    return billed === plain ? (
      <>{inr(plain)}</>
    ) : (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className="text-xs font-normal text-muted-foreground line-through">{inr(plain)}</span>
        <span>{inr(billed)}</span>
      </span>
    );
  };

  /**
   * The items, shared by the grouped and flat layouts: a stacked list on phones (nine
   * columns don't fit 375px) and the full table from `md` up.
   */
  const ItemsTable = ({ items }: { items: OrderItem[] }) => (
    <>
      <ul className="divide-y md:hidden">
        {items?.map((item: OrderItem) => (
          <li key={item.id} className="grid gap-1.5 px-1 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-muted-foreground">{item.s_no}. </span>
                <span className="font-medium">{item.media}</span>
              </div>
              {hasFinancials && (
                <span className="shrink-0 font-semibold tabular-nums"><AmountCell item={item} /></span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
              <span>{item.width_inches} x {item.height_inches} in</span>
              <span>Qty {item.qty}</span>
              <span>{(item.total_sft || 0).toFixed(2)} sft</span>
              {hasFinancials && <span>@ ₹{item.rate}</span>}
            </div>
            {showProduction && <ProductionCell item={item} />}
            {(item.is_flagged || item.remarks) && remarksFor(item)}
            {userRole && <div className="flex justify-end">{actionsFor(item)}</div>}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead>Media</TableHead>
              <TableHead className="text-right">Size (in)</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total Sft</TableHead>
              {hasFinancials && <TableHead className="text-right">Rate (₹)</TableHead>}
              {hasFinancials && <TableHead className="text-right">Amount (₹)</TableHead>}
              {showProduction && <TableHead>Production</TableHead>}
              <TableHead>Remarks / Flags</TableHead>
              {userRole && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items?.map((item: OrderItem) => (
              <TableRow key={item.id}>
                <TableCell className="text-center text-muted-foreground">{item.s_no}</TableCell>
                <TableCell className="font-medium">{item.media}</TableCell>
                <TableCell className="text-right">{item.width_inches} x {item.height_inches}</TableCell>
                <TableCell className="text-right">{item.qty}</TableCell>
                <TableCell className="text-right">{(item.total_sft || 0).toFixed(2)}</TableCell>
                {hasFinancials && <TableCell className="text-right">{item.rate}</TableCell>}
                {hasFinancials && <TableCell className="text-right font-semibold"><AmountCell item={item} /></TableCell>}
                {showProduction && (
                  <TableCell>
                    <ProductionCell item={item} />
                  </TableCell>
                )}
                <TableCell>
                  {remarksFor(item)}
                </TableCell>
                {userRole && (
                  <TableCell className="text-right">
                    {actionsFor(item)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <motion.section
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="surface-panel p-4 sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Order Details</h2>
          <StatusBadge status={order.status} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground uppercase">Order No</div>
            <div className="font-semibold">{order.order_no}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase">Client</div>
            <div className="font-semibold">{order.client_name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase">
              {stores.length > 1 ? "Stores" : "Store & Location"}
            </div>
            <div className="font-semibold">
              {stores.length > 1
                ? `${stores.length} stores`
                : stores.length === 1
                  ? `${stores[0].store_name} (${stores[0].location})`
                  : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase">Date</div>
            <div className="font-semibold">{format(new Date(order.date || order.created_at), "MMM d, yyyy")}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase">Job PO Number</div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{order.po_number || <span className="text-muted-foreground font-normal">Not set</span>}</span>
              {canEditHeader && (
                <PoDialog
                  title="Job PO Number"
                  description="For the whole order. Blank clears it."
                  current={order.po_number ?? ""}
                  onSave={handleJobPo}
                  isSubmitting={isSubmitting}
                />
              )}
            </div>
          </div>
          {order.creator && (
            <div>
              <div className="text-xs text-muted-foreground uppercase">Created By</div>
              <div className="font-semibold">{order.creator.name}</div>
            </div>
          )}
          {order.remarks && (
            <div>
              <div className="text-xs text-muted-foreground uppercase">Remarks</div>
              <div className="font-semibold">{remarkLabel(order.remarks)}</div>
            </div>
          )}
          {order.remarks_other_text && (
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="text-xs text-muted-foreground uppercase">Custom Remarks</div>
              <div className="font-semibold text-muted-foreground mt-1 whitespace-pre-wrap">{order.remarks_other_text}</div>
            </div>
          )}
        </div>
      </motion.section>

      <motion.section
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="surface-panel p-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Line Items</h2>
          {showProduction && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${allProduced ? "bg-success/15 text-success" : "bg-info/15 text-info"}`}>
              {allProduced ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Factory className="h-3.5 w-3.5" />}
              {allProduced ? "Production complete" : `In production — ${producedItems} of ${assignedItems.length} items done`}
            </span>
          )}
        </div>

        {grouped ? (
          stores.map((store: any) => {
            const invoice = store.invoice_id != null ? invoiceById.get(store.invoice_id) : undefined;
            return (
              <div key={store.id} className="border-t">
                <div className="flex flex-wrap items-start justify-between gap-3 bg-muted/20 px-6 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      {storeRef(store)}
                      <span className="ml-2 font-normal text-muted-foreground">{store.location}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        PO: {store.po_number || <span className="italic">not set</span>}
                        {canEditHeader && (
                          <PoDialog
                            title={`PO for ${store.store_name}`}
                            description="For this store only. Blank clears it."
                            current={store.po_number ?? ""}
                            onSave={(po) => handleStorePo(store.id, po)}
                            isSubmitting={isSubmitting}
                            compact
                          />
                        )}
                      </span>
                      <span>
                        {store.installed_at
                          ? `Installed ${format(new Date(store.installed_at), "MMM d, yyyy")}`
                          : "Not yet installed"}
                      </span>
                      {invoice && <span>Invoice {invoice.invoice_no}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasFinancials && store.total_amount !== undefined && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Store total</div>
                        <div className="font-semibold">{inr(store.total_amount)}</div>
                      </div>
                    )}
                    {canInstall && !store.installed_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        disabled={isSubmitting}
                        onClick={() => handleInstallStore(store.id, store.store_name)}
                      >
                        <PackageCheck className="mr-1 h-3.5 w-3.5" /> Mark installed
                      </Button>
                    )}
                  </div>
                </div>
                <ItemsTable items={store.items ?? []} />
              </div>
            );
          })
        ) : (
          <ItemsTable items={order.items ?? []} />
        )}

        {hasFinancials && (
          <OrderAdjustmentsPanel order={order} userRole={userRole} isCreator={isCreator} />
        )}

        {hasFinancials && order.total_amount !== undefined && (
          <div className="bg-muted/30 p-6 flex flex-wrap justify-end gap-8">
            {order.loss_amount ? (
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Loss (written off)</div>
                <div className="text-xl font-semibold text-amber-600 dark:text-amber-500">{inr(order.loss_amount)}</div>
              </div>
            ) : null}
            {order.adjustment_amount ? (
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Amount changes</div>
                <div className="text-xl font-semibold">
                  {order.adjustment_amount > 0 ? "+" : "−"}{inr(Math.abs(order.adjustment_amount))}
                </div>
              </div>
            ) : null}
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                {order.loss_amount || order.adjustment_amount ? "Billable Total" : "Total Order Value"}
              </div>
              <div className="text-3xl font-bold text-primary">{inr(order.total_amount)}</div>
            </div>
          </div>
        )}
      </motion.section>

      {related}

      {actions && (
        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="surface-panel p-4 sm:p-6"
        >
          {actions}
        </motion.section>
      )}
    </div>
  );
}

/**
 * One-field PO editor. A PO usually turns up after the invoice, and reopening the whole
 * order form to type it in is what made people skip it.
 */
function PoDialog({
  title, description, current, onSave, isSubmitting, compact,
}: {
  title: string;
  description: string;
  current: string;
  onSave: (po: string) => void;
  isSubmitting: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(value);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(current); }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "sm" : "icon"}
          className={compact ? "ml-1 h-5 px-1.5 text-[10px]" : "h-6 w-6"}
          title={current ? "Edit PO number" : "Add PO number"}
        >
          {compact ? (current ? "Edit" : "Add") : <Pencil className="h-3 w-3" />}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">{description}</p>
          <div className="space-y-2">
            <Label>PO Number</Label>
            <Input aria-label="PO Number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 450001234512345" autoFocus />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductionCell({ item }: { item: OrderItem }) {
  const assignments = item.assignments ?? [];
  if (assignments.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-1">
      {item.production_completed ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Produced
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {assignments.filter((a) => a.completed).length} of {assignments.length} teams done
        </span>
      )}
      <div className="flex flex-wrap gap-1">
        {assignments.map((a) => (
          <span
            key={a.id}
            className={`rounded px-1.5 py-0.5 text-[10px] ${a.completed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
            title={a.completed ? "Completed" : "In progress"}
          >
            {a.user?.name ?? `#${a.user_id}`}{a.completed ? " ✓" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function FlagDialog({ item, onSave, isSubmitting }: { item: OrderItem, onSave: (f: boolean, r?: string) => void, isSubmitting: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(item.flag_reason || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return toast.error("Reason is required");
    onSave(true, reason);
    setOpen(false);
  };

  const handleRemove = () => {
    onSave(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={item.is_flagged ? "destructive" : "outline"} size="icon" className="h-7 w-7" title={item.is_flagged ? "Update Flag" : "Flag Item"}>
          <Flag className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.is_flagged ? "Update Flag" : "Flag Line Item"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Reason for flagging *</Label>
            <Input aria-label="Reason for flagging *" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Dimensions incorrect" />
          </div>
          <DialogFooter className="flex justify-between items-center sm:justify-between">
            {item.is_flagged ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleRemove} disabled={isSubmitting}>Remove Flag</Button>
            ) : <div />}
            <Button type="submit" disabled={isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Admin: set, confirm or clear a line remark. A CSM's proposal (loss or Extra / Less request)
 * is approved by saving it, changed by picking another, or rejected with a note. Revised is
 * not offered here: it comes from editing the line's size, qty or rate.
 */
function RemarkDialog({ item, onSave, isSubmitting }: { item: OrderItem, onSave: (p: ItemRemarkPayload) => void, isSubmitting: boolean }) {
  const [open, setOpen] = useState(false);
  const [remark, setRemark] = useState<string>(item.remarks || "none");
  const [reason, setReason] = useState(item.remarks_other_text || "");
  const [figure, setFigure] = useState(item.adjustment_amount != null ? String(item.adjustment_amount) : "");
  const [mode, setMode] = useState<"discount" | "newAmount">("discount");
  const [note, setNote] = useState("");

  const isProposed = !!item.remarks && !item.remarks_confirmed;
  const base = Number(item.amount) || 0;
  const reset = () => {
    setRemark(item.remarks || "none");
    setReason(item.remarks_other_text || "");
    setFigure(item.adjustment_amount != null ? String(item.adjustment_amount) : "");
    setMode("discount");
    setNote("");
  };

  const save = (r: string | null) => {
    const payload: ItemRemarkPayload = { remarks: r, decision_note: note.trim() || null };
    if (r && remarkNeedsReason(r)) {
      if (!reason.trim()) return toast.error("A reason is required.");
      payload.remarks_other_text = reason.trim();
    }
    if (isAmountRemark(r)) {
      const amount = figureOf(r as "ExtraAmount" | "LessAmount", base, figure, mode);
      if (!(amount > 0)) return toast.error("Enter the amount.");
      if (r === "LessAmount" && amount > base) return toast.error("A Less Amount cannot be more than the line.");
      payload.adjustment_amount = Number(amount.toFixed(2));
    }
    onSave(payload);
    setOpen(false);
  };

  const picked = remark === "none" ? null : remark;
  const options = [
    ...LOSS_REMARK_TYPES,
    { value: "ExtraAmount" as RemarkType, label: "Extra Amount" },
    { value: "LessAmount" as RemarkType, label: "Less Amount" },
    // Kept visible only when the line is already Revised.
    ...(item.remarks === "Revised" ? [{ value: "Revised" as RemarkType, label: "Revised" }] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          variant={isProposed ? "default" : item.remarks ? "secondary" : "outline"}
          size="icon"
          className="h-7 w-7"
          title={isProposed ? "Review the CSM's request" : item.remarks ? "Update remark" : "Add remark"}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isProposed ? "Review request" : "Line remark"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save(picked); }} className="space-y-4 pt-2">
          {isProposed && (
            <div className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300">
              The CSM asked for <strong>{remarkLabel(item.remarks)}</strong>
              {isAmountRemark(item.remarks) && <> of <strong>{inr(Number(item.adjustment_amount) || 0)}</strong></>}.
              Approve it as it is, change it, or reject it. The line is billed at {inr(base)} until you decide.
            </div>
          )}
          <div className="space-y-2">
            <Label>Remark</Label>
            <Select value={remark} onValueChange={setRemark}>
              <SelectTrigger aria-label="Remark"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-muted-foreground italic">{NORMAL_REMARK_LABEL}</SelectItem>
                {options.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isLossRemark(picked)
                ? "Not billed: the whole line is written off."
                : isAmountRemark(picked)
                  ? "Billed with the figure below."
                  : picked === "Revised"
                    ? "Edit the line on the order to change its size, qty or rate."
                    : `Billed at ${inr(base)}.`}
            </p>
          </div>
          {isAmountRemark(picked) && (
            <AdjustmentFigure
              type={picked as "ExtraAmount" | "LessAmount"}
              base={base}
              value={figure}
              onChange={setFigure}
              mode={mode}
              onModeChange={setMode}
              idPrefix={`remark-${item.id}`}
            />
          )}
          {remarkNeedsReason(picked) && (
            <div className="space-y-2">
              <Label htmlFor={`remark-${item.id}-reason`}>Reason *</Label>
              <Textarea id={`remark-${item.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" />
            </div>
          )}
          {isProposed && (
            <div className="space-y-2">
              <Label htmlFor={`remark-${item.id}-note`}>Note to the CSM (optional)</Label>
              <Input id={`remark-${item.id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sent with your decision" />
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {isProposed ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={isSubmitting}
                onClick={() => save(null)}
              >
                Reject
              </Button>
            ) : <div />}
            <Button type="submit" disabled={isSubmitting}>
              {isProposed ? (picked === item.remarks ? "Approve" : picked ? "Save changed" : "Reject") : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
