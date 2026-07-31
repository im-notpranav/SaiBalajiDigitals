import { motion } from "framer-motion";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Flag, MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "./StatusBadge";
import { inr } from "@/lib/format";
import { remarkLabel, LOSS_REMARK_TYPES } from "@/lib/constants";
import type { Order, OrderItem, RemarkType } from "@sb-oms/shared-types";
import { flagOrderItem, setItemLossRemark } from "@/api/orders";
import { useQueryClient } from "@tanstack/react-query";

export interface OrderDetailProps {
  order: Order | any;
  actions?: React.ReactNode;
  userRole?: string;
}

export function OrderDetail({ order, actions, userRole }: OrderDetailProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

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
            <div className="text-xs text-muted-foreground uppercase">Store & Location</div>
            <div className="font-semibold">{order.store_name} ({order.location})</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase">Date</div>
            <div className="font-semibold">{format(new Date(order.date || order.created_at), "MMM d, yyyy")}</div>
          </div>
          {order.po_number && (
            <div>
              <div className="text-xs text-muted-foreground uppercase">PO Number</div>
              <div className="font-semibold">{order.po_number}</div>
            </div>
          )}
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
        <div className="p-6 pb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Line Items</h2>
        </div>
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
              <TableHead>Remarks / Flags</TableHead>
              {userRole && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items?.map((item: OrderItem) => (
              <TableRow key={item.id}>
                <TableCell className="text-center text-muted-foreground">{item.s_no}</TableCell>
                <TableCell className="font-medium">{item.media}</TableCell>
                <TableCell className="text-right">{item.width_inches} x {item.height_inches}</TableCell>
                <TableCell className="text-right">{item.qty}</TableCell>
                <TableCell className="text-right">{(item.total_sft || 0).toFixed(2)}</TableCell>
                {hasFinancials && <TableCell className="text-right">{item.rate}</TableCell>}
                {hasFinancials && <TableCell className="text-right font-semibold">{inr(item.amount || 0)}</TableCell>}
                <TableCell>
                  <div className="space-y-1">
                    {item.is_flagged && (
                      <div className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                        Flagged
                        {item.flag_reason && <span className="ml-1 font-normal opacity-80">({item.flag_reason})</span>}
                      </div>
                    )}
                    {item.remarks && (
                      <div className="text-xs">
                        <span className="font-medium text-amber-600 dark:text-amber-500">{remarkLabel(item.remarks)}</span>
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
                      {(userRole === "employee" || userRole === "admin") && order.status === "Active" && (
                        <FlagDialog 
                          item={item} 
                          onSave={(flagged, reason) => handleFlagItem(item.id!, flagged, reason)} 
                          isSubmitting={isSubmitting} 
                        />
                      )}
                      {userRole === "admin" && (
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
        
        {hasFinancials && order.total_amount !== undefined && (
          <div className="bg-muted/30 p-6 flex justify-end">
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Order Value</div>
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (remark === "Other" && !custom.trim()) return toast.error("Custom remark is required");
    onSave(remark === "none" ? null : remark, remark === "Other" ? custom : undefined);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={item.remarks ? "secondary" : "outline"} size="icon" className="h-7 w-7" title={item.remarks ? "Update Remark" : "Add Remark"}>
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Item Loss Remark</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
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
            <Button type="submit" disabled={isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
