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
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { inr } from "@/lib/format";
import type { Order } from "@sb-oms/shared-types";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { SortableHead, useSortableTable } from "@/hooks/useSortableTable";

interface OrdersTableProps {
  orders: Order[];
  showCreator?: boolean;
  showAmount?: boolean;
  action?: (o: Order) => ReactNode;
  detailBase?: string;
}

export function OrdersTable({
  orders,
  showCreator,
  showAmount = true,
  action,
  detailBase,
}: OrdersTableProps) {
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(
    orders,
    "created_at",
    (o, key) => {
      if (key === "created_at") return o.created_at ? new Date(o.created_at) : new Date(0);
      if (key === "total_amount") return o.total_amount ?? 0;
      if (key === "order_no") return o.order_no;
      if (key === "client_name") return o.client_name;
      if (key === "store_name") return o.store_name;
      if (key === "status") return o.status;
      if (key === "creator_name") return o.creator_name ?? "";
      if (key === "items") return o.items.length;
      return "";
    },
  );

  const colSpan = (showCreator ? 1 : 0) + (showAmount ? 1 : 0) + 6;

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
                <SortableHead label="Store" column="store_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              {showCreator && (
                <TableHead>
                  <SortableHead label="Created by" column="creator_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </TableHead>
              )}
              <TableHead>
                <SortableHead label="Items" column="items" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              {showAmount && (
                <TableHead className="text-right">
                  <SortableHead label="Total" column="total_amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-full justify-end" />
                </TableHead>
              )}
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
                <TableCell colSpan={colSpan + (action ? 1 : 0)} className="h-32 text-center text-muted-foreground">
                  No orders match your filters.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((o) => (
              <TableRow key={o.id} className="group">
                <TableCell className="font-mono text-xs font-semibold text-primary">{o.order_no}</TableCell>
                <TableCell className="font-medium">{o.client_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{o.store_name}</TableCell>
                {showCreator && <TableCell className="text-sm text-muted-foreground">{o.creator_name}</TableCell>}
                <TableCell className="text-sm text-muted-foreground">{o.items.length}</TableCell>
                {showAmount && (
                  <TableCell className="text-right font-semibold">{inr(o.total_amount ?? 0)}</TableCell>
                )}
                <TableCell><StatusBadge status={o.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {o.created_at
                    ? formatDistanceToNow(new Date(o.created_at), { addSuffix: true })
                    : "—"}
                </TableCell>
                {action ? (
                  <TableCell className="text-right">{action(o)}</TableCell>
                ) : detailBase ? (
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to={detailBase}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Link>
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
