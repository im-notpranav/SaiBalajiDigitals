import { motion } from "framer-motion";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import { inr } from "@/lib/format";
import type { Order, OrderItem } from "@sb-oms/shared-types";

export interface OrderDetailProps {
  order: Order | any;
  actions?: React.ReactNode;
}

export function OrderDetail({ order, actions }: OrderDetailProps) {
  // Production role strips rate and amount from items, check if they exist
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
              <TableHead>Remarks</TableHead>
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
                <TableCell className="text-muted-foreground text-xs">{item.remarks || "-"}</TableCell>
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
