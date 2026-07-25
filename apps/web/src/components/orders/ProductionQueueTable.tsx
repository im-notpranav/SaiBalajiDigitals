import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSft } from "@/lib/format";
import type { ProductionOrder } from "@sb-oms/shared-types";
import { SortableHead, useSortableTable } from "@/hooks/useSortableTable";

interface QueueRow {
  order_no: string;
  client_name: string;
  store_name: string;
  location: string;
  media: string;
  size: string;
  qty: number;
  total_sft: number;
  showOrderNo: boolean;
}

function flattenOrders(orders: ProductionOrder[]): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const order of orders) {
    order.items.forEach((item, idx) => {
      rows.push({
        order_no: order.order_no,
        client_name: order.client_name,
        store_name: order.store_name,
        location: order.location,
        media: item.media,
        size: `${item.width_inches} × ${item.height_inches}`,
        qty: item.qty,
        total_sft: item.total_sft,
        showOrderNo: idx === 0,
      });
    });
  }
  return rows;
}

export function ProductionQueueTable({ orders }: { orders: ProductionOrder[] }) {
  const flat = flattenOrders(orders);

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(
    flat,
    "order_no",
    (row, key) => {
      if (key === "qty" || key === "total_sft") return row[key];
      return String(row[key as keyof QueueRow] ?? "");
    },
  );

  return (
    <div className="surface-panel overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>
                <SortableHead label="Order No" column="order_no" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Client Name" column="client_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Store Name" column="store_name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Location" column="location" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Media" column="media" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>Size (W × H, in)</TableHead>
              <TableHead>
                <SortableHead label="Quantity" column="qty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
              <TableHead>
                <SortableHead label="Total SFT" column="total_sft" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  No active orders in the production queue.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((row, i) => (
              <TableRow key={`${row.order_no}-${i}`}>
                <TableCell className="font-mono text-xs font-semibold text-primary">
                  {row.showOrderNo ? row.order_no : <span className="text-muted-foreground">↳</span>}
                </TableCell>
                <TableCell>{row.client_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.store_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.location}</TableCell>
                <TableCell>{row.media}</TableCell>
                <TableCell className="font-mono text-sm">{row.size}</TableCell>
                <TableCell>{row.qty}</TableCell>
                <TableCell className="font-mono">{formatSft(row.total_sft)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
