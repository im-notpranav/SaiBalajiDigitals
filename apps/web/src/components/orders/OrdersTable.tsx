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
import { inr } from "@/lib/format";
import type { Order } from "@sb-oms/shared-types";
import { formatDistanceToNow } from "date-fns";
import { PackageSearch } from "lucide-react";
import { SortableHead, useSortableTable } from "@/hooks/useSortableTable";
import { storeLabel, storeSubLabel } from "@/lib/stores";
import { EmptyState, ErrorState, LoadingState, TableStateRow } from "@/components/layout/PageStates";
import { useRowLink, type RowLinkTarget } from "@/hooks/useRowLink";
import { cn } from "@/lib/utils";

interface OrdersTableProps {
  orders: Order[];
  showCreator?: boolean;
  showAmount?: boolean;
  action?: (o: Order) => ReactNode;
  /** Where a click anywhere on the order's row or card goes; null leaves that row inert. */
  rowLink?: (o: Order) => RowLinkTarget | null;
  /** The list is still loading; shown in place of the rows. */
  loading?: boolean;
  /** The list failed to load; shown in place of the rows, with a retry. */
  error?: unknown;
  onRetry?: () => void;
  emptyText?: string;
  /** What an allotted, not-yet-filled order says where its store would be. */
  waitingLabel?: string;
}

const created = (o: Order) =>
  o.created_at ? formatDistanceToNow(new Date(o.created_at), { addSuffix: true }) : "—";

/** Allotted by an admin and not filled yet: no stores and no items (the API's ?waiting=1). */
const isWaitingForCsm = (o: Pick<Order, "store_count" | "stores" | "items">) =>
  (o.store_count ?? o.stores?.length ?? 0) === 0 && (o.items?.length ?? 0) === 0;

/** Sits in the store's place, so a waiting row is no taller than any other. */
function WaitingBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </span>
  );
}

export function OrdersTable({
  orders,
  showCreator,
  showAmount = true,
  action,
  rowLink,
  loading,
  error,
  onRetry,
  emptyText = "No orders match your filters.",
  waitingLabel = "Waiting for CSM",
}: OrdersTableProps) {
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable(
    orders,
    "created_at",
    (o, key) => {
      if (key === "created_at") return o.created_at ? new Date(o.created_at) : new Date(0);
      if (key === "total_amount") return o.total_amount ?? 0;
      if (key === "order_no") return o.order_no;
      if (key === "client_name") return o.client_name;
      if (key === "store") return storeLabel(o);
      if (key === "status") return o.status;
      if (key === "creator_name") return o.creator_name ?? "";
      if (key === "items") return o.items.length;
      return "";
    },
  );

  const linkProps = useRowLink();
  const rowProps = (o: Order, className?: string) => {
    const { className: linkClass, ...handlers } = linkProps(rowLink?.(o));
    return { ...handlers, className: cn(className, linkClass) };
  };

  const colSpan = (showCreator ? 1 : 0) + (showAmount ? 1 : 0) + 6 + (action ? 1 : 0);
  const failed = !loading && !!error && orders.length === 0;
  const empty = !loading && !failed && sorted.length === 0;

  return (
    <>
      {/* Phones get one card per order: nine columns don't fit 375px, and a sideways-
          scrolling table hides the status and actions off the edge. */}
      <div className="md:hidden">
        {loading ? (
          <LoadingState label="Loading orders…" />
        ) : failed ? (
          <ErrorState title="Couldn't load orders" error={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState icon={PackageSearch} title={emptyText} />
        ) : (
          <ul className="grid gap-3">
            {sorted.map((o) => (
              <li key={o.id} {...rowProps(o, "surface-panel grid gap-2 p-4")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold text-primary">{o.order_no}</div>
                    <div className="truncate font-medium">{o.client_name}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="text-sm text-muted-foreground">
                  {isWaitingForCsm(o) ? (
                    <WaitingBadge label={waitingLabel} />
                  ) : (
                    <>
                      {storeLabel(o)}
                      {storeSubLabel(o) && <span className="text-xs"> · {storeSubLabel(o)}</span>}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {o.items.length} item{o.items.length === 1 ? "" : "s"}
                  </span>
                  {showAmount && (
                    <span className="font-semibold text-foreground tabular-nums">
                      {inr(o.total_amount ?? 0)}
                    </span>
                  )}
                  {showCreator && o.creator_name && <span>by {o.creator_name}</span>}
                  <span>{created(o)}</span>
                </div>
                {action && <div className="-mx-1 border-t pt-2">{action(o)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="surface-panel hidden overflow-hidden md:block">
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
              {(loading || failed || empty) && (
                <TableStateRow
                  colSpan={colSpan}
                  loading={loading}
                  loadingLabel="Loading orders…"
                  error={failed ? error : undefined}
                  onRetry={onRetry}
                  empty={{ icon: PackageSearch, title: emptyText }}
                />
              )}
              {!loading &&
                sorted.map((o) => (
                  <TableRow key={o.id} {...rowProps(o, "group")}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold text-primary">{o.order_no}</TableCell>
                    <TableCell className="font-medium">{o.client_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {isWaitingForCsm(o) ? (
                        <WaitingBadge label={waitingLabel} />
                      ) : (
                        <>
                          <div>{storeLabel(o)}</div>
                          {storeSubLabel(o) && (
                            <div className="text-xs text-muted-foreground/70">{storeSubLabel(o)}</div>
                          )}
                        </>
                      )}
                    </TableCell>
                    {showCreator && <TableCell className="text-sm text-muted-foreground">{o.creator_name}</TableCell>}
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{o.items.length}</TableCell>
                    {showAmount && (
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{inr(o.total_amount ?? 0)}</TableCell>
                    )}
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{created(o)}</TableCell>
                    {action ? (
                      <TableCell className="text-right">{action(o)}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
