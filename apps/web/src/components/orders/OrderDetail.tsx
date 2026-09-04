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
import { remarkLabel, LOSS_REMARK_TYPES } from "@/lib/constants";
import type { Order, OrderItem, RemarkType } from "@sb-oms/shared-types";
import { flagOrderItem, setItemLossRemark, markStoreInstalled, updateStore, updateOrderDetails } from "@/api/orders";
import { storeRef } from "@/lib/stores";
import { useQueryClient } from "@tanstack/react-query";

export interface OrderDetailProps {
  order: Order | any;
  actions?: React.ReactNode;
  userRole?: string;
  /** The signed-in user, so per-store install is offered only to the order's creator. */
  currentUserId?: number;
}

export function OrderDetail({ order, actions, userRole, currentUserId }: OrderDetailProps) {
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

  const handleSetRemark = async (itemId: number, remark: string | null, custom?: string) => {
    setIsSubmitting(true);
    try {
      await setItemLossRemark(order.id, itemId, remark, custom);
      toast.success(remark ? "Loss remark saved" : "Loss remark removed");
      queryClient.invalidateQueries({ queryKey: ["order", order.id.toString()] });
    } catch (err: any) {
      toast.error("Failed to set remark", { description: err.message });
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

  /** The item table, shared by the grouped and flat layouts. */
  const ItemsTable = ({ items }: { items: OrderItem[] }) => (
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
            {hasFinancials && <TableCell className="text-right font-semibold">{inr(item.amount || 0)}</TableCell>}
            {showProduction && (
              <TableCell>
                <ProductionCell item={item} />
              </TableCell>
            )}
            <TableCell>
              <div className="space-y-1">
                {item.is_flagged && (
                  <div className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    Flagged
                    {item.flag_reason && <span className="ml-1 font-normal opacity-80">({item.flag_reason})</span>}
                  </div>
                )}
                {item.remarks && item.remarks_confirmed && (
                  <div className="text-xs">
                    <span className="font-medium text-amber-600 dark:text-amber-500">Loss: {remarkLabel(item.remarks)}</span>
                    {item.remarks_other_text && <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap max-w-[200px] truncate" title={item.remarks_other_text}>{item.remarks_other_text}</div>}
                  </div>
                )}
                {item.remarks && !item.remarks_confirmed && (
                  <div className="text-xs">
                    <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 font-medium text-blue-600 dark:text-blue-400">
                      Proposed loss: {remarkLabel(item.remarks)}
                    </span>
                    <div className="text-muted-foreground mt-0.5">pending admin approval</div>
                    {item.remarks_other_text && <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap max-w-[200px] truncate" title={item.remarks_other_text}>{item.remarks_other_text}</div>}
                  </div>
                )}
                {!item.is_flagged && !item.remarks && (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
            </TableCell>
            {userRole && (
              <TableCell className="text-right">
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
                  {userRole === "ADMIN" && (
                    <RemarkDialog
                      item={item}
                      onSave={(remark, custom) => handleSetRemark(item.id!, remark, custom)}
                      isSubmitting={isSubmitting}
                    />
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="surface-panel p-6"
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
                  description="Covers the whole order. Leave blank to clear it."
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
        initial={{ opacity: 0, y: 10 }}
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
                            description="Covers this store only. Leave blank to clear it."
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

        {hasFinancials && order.total_amount !== undefined && (
          <div className="bg-muted/30 p-6 flex flex-wrap justify-end gap-8">
            {order.loss_amount ? (
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Loss (written off)</div>
                <div className="text-xl font-semibold text-amber-600 dark:text-amber-500">{inr(order.loss_amount)}</div>
              </div>
            ) : null}
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                {order.loss_amount ? "Billable Total" : "Total Order Value"}
              </div>
              <div className="text-3xl font-bold text-primary">{inr(order.total_amount)}</div>
            </div>
          </div>
        )}
      </motion.section>

      {actions && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="surface-panel p-6"
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
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. PO-12345" autoFocus />
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
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Dimensions incorrect" />
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

function RemarkDialog({ item, onSave, isSubmitting }: { item: OrderItem, onSave: (r: string | null, custom?: string) => void, isSubmitting: boolean }) {
  const [open, setOpen] = useState(false);
  const [remark, setRemark] = useState<string>(item.remarks || "none");
  const [custom, setCustom] = useState(item.remarks_other_text || "");

  const isProposed = !!item.remarks && !item.remarks_confirmed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (remark === "Other" && !custom.trim()) return toast.error("Custom remark is required");
    onSave(remark === "none" ? null : remark, remark === "Other" ? custom : undefined);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={isProposed ? "default" : item.remarks ? "secondary" : "outline"}
          size="icon"
          className="h-7 w-7"
          title={isProposed ? "Review proposed loss" : item.remarks ? "Update loss remark" : "Add loss remark"}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isProposed ? "Review Proposed Loss" : "Item Loss Remark"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {isProposed && (
            <div className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300">
              An employee proposed this line as a loss. Confirm to write it off (it will be excluded from the
              billable total), change the category, or set to <strong>None</strong> to reject and keep it billable.
            </div>
          )}
          <div className="space-y-2">
            <Label>Remark Category</Label>
            <Select value={remark} onValueChange={setRemark}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-muted-foreground italic">None</SelectItem>
                {LOSS_REMARK_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {remark === "Other" && (
            <div className="space-y-2">
              <Label>Custom Remark *</Label>
              <Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Type remark..." />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isProposed ? (remark === "none" ? "Reject" : "Confirm loss") : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
