import React from "react";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/orders/StatusBadge";
import type { Order } from "@sb-oms/shared-types";
import { formatDistanceToNow } from "date-fns";
import { SortableHead, useSortableTable } from "@/hooks/useSortableTable";
import { storeLabel, storeSubLabel } from "@/lib/stores";

interface ProductionQueueTableProps {
  orders: Order[];
  action?: (o: Order) => ReactNode;
}

export function ProductionQueueTable({
  orders,
  action,
}: ProductionQueueTableProps) {
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(
    orders,
    "created_at",
    (o, key) => {
      if (key === "created_at") return o.created_at ? new Date(o.created_at) : new Date(0);
      if (key === "order_no") return o.order_no;
      if (key === "client_name") return o.client_name;
      if (key === "store") return storeLabel(o);
      if (key === "location") return storeSubLabel(o);
      if (key === "status") return o.status;
      return "";
    },
  );

  return (
    <div className="surface-panel overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[130px]">
                <SortableHead label="Order #" column="order_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Client" column="client_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Store" column="store" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Location" column="store" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Status" column="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Created" column="created_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              {action && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No active orders in the production queue.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((o) => (
              <React.Fragment key={o.id}>
                <TableRow className="group bg-muted/10">
                  <TableCell className="font-mono text-xs font-semibold text-primary">{o.order_no}</TableCell>
                  <TableCell className="font-medium">{o.client_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{storeLabel(o)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{storeSubLabel(o) || "—"}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.created_at
                      ? formatDistanceToNow(new Date(o.created_at), { addSuffix: true })
                      : "—"}
                  </TableCell>
                  {action ? (
                    <TableCell className="text-right">{action(o)}</TableCell>
                  ) : null}
                </TableRow>
                <TableRow className="border-b-2 hover:bg-transparent">
                  <TableCell colSpan={7} className="p-0 pb-4">
                    <div className="px-4 pt-2">
                      <Table className="bg-background border rounded-lg overflow-hidden">
                        <TableHeader>
                          <TableRow className="bg-muted/20">
                            <TableHead className="py-2 text-xs">Media</TableHead>
                            <TableHead className="py-2 text-xs">Size (W x H)</TableHead>
                            <TableHead className="py-2 text-xs text-right">Qty</TableHead>
                            <TableHead className="py-2 text-xs text-right">Total SFT</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {o.items?.map((item) => (
                            <TableRow key={item.id} className="hover:bg-muted/10">
                              <TableCell className="py-2 font-medium">{item.media}</TableCell>
                              <TableCell className="py-2 text-sm text-muted-foreground">{Number(item.width_inches)}″ × {Number(item.height_inches)}″</TableCell>
                              <TableCell className="py-2 text-right">{Number(item.qty)}</TableCell>
                              <TableCell className="py-2 text-right font-semibold">{Number(item.total_sft)}</TableCell>
                            </TableRow>
                          ))}
                          {(!o.items || o.items.length === 0) && (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-2">
                                No items found
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
