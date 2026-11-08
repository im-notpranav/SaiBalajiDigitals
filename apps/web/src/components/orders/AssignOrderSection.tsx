import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronsUpDown, Flag, ListChecks, Sparkles, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  assignOrderItem,
  bulkAssignOrderItems,
  fetchAssignSuggestions,
  type BulkAssignMode,
} from "@/api/orders";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { storeLabel, storeSubLabel } from "@/lib/stores";
import type { Order, OrderItem } from "@sb-oms/shared-types";

type Staff = { id: number; name: string };
type Assignment = { item_id: number; user_ids: number[] };

type ApiError = { message?: string; response?: { data?: { message?: string } } };
const errorText = (err: unknown) => {
  const e = err as ApiError | null;
  return e?.response?.data?.message || e?.message;
};
const isClosed = (o: Order) => o.status === "Completed" || o.status === "PaymentReceived";
const assignedCount = (i: OrderItem) => i.assignments?.length ?? 0;
const NONE: ReadonlySet<number> = new Set();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One order on the Assign Work page. Teams can be set per item, or for many items at
 * once: tick items (shift-click ticks a range), pick teams in the bar, then Add or Replace.
 * "Suggest from history" fills unassigned items with the teams their media usually gets.
 */
export function AssignOrderSection({
  order,
  staff,
  active,
  onActivate,
}: {
  order: Order;
  staff: Staff[];
  /** Only one order holds a selection at a time, so only one action bar shows. */
  active: boolean;
  onActivate: () => void;
}) {
  const queryClient = useQueryClient();
  const items = useMemo(() => order.items ?? [], [order.items]);
  const closed = isClosed(order);
  /** Finished items stay out of bulk actions, so a bulk save never reopens work. */
  const selectable = useMemo(
    () => (closed ? [] : items.filter((i) => !i.production_completed)),
    [closed, items],
  );
  const assigned = items.filter((i) => assignedCount(i) > 0);
  const done = assigned.filter((i) => i.production_completed).length;
  const openUnassigned = selectable.filter((i) => assignedCount(i) === 0);

  const [ticked, setSelected] = useState<Set<number>>(new Set());
  const selected = active ? ticked : NONE;
  const [teams, setTeams] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const nameOf = (id: number) => staff.find((s) => s.id === id)?.name ?? `#${id}`;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["orders"] });

  const single = useMutation({
    mutationFn: ({ itemId, assignedTo }: { itemId: number; assignedTo: number[] }) =>
      assignOrderItem(order.id, itemId, assignedTo),
    onSuccess: (_res, vars) => {
      refresh();
      toast.success(vars.assignedTo.length === 0 ? "Assignments cleared" : "Assignments updated");
    },
    onError: (err) => toast.error("Failed to assign", { description: errorText(err) }),
  });

  const bulk = useMutation({
    mutationFn: ({ mode, assignments }: { mode: BulkAssignMode; assignments: Assignment[] }) =>
      bulkAssignOrderItems(order.id, mode, assignments),
    onSuccess: (res) => {
      refresh();
      setSelected(new Set());
      setTeams(new Set());
      const skipped =
        res.skipped > 0 ? `${plural(res.skipped, "finished item")} left as they were.` : undefined;
      toast.success(
        res.updated === 0 ? "Nothing to change." : `Updated ${plural(res.updated, "item")}.`,
        {
          description: skipped,
        },
      );
    },
    onError: (err) => toast.error("Failed to assign", { description: errorText(err) }),
  });
  const busy = single.isPending || bulk.isPending;

  const toggleAssignee = (item: OrderItem, userId: number) => {
    const current = (item.assignments ?? []).map((a) => a.user_id);
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    single.mutate({ itemId: item.id!, assignedTo: next });
  };

  /** Tick one item; with shift held, tick or untick everything since the last click. */
  const clickItem = (item: OrderItem, shift: boolean) => {
    const idx = selectable.findIndex((i) => i.id === item.id);
    const anchor = shift ? lastClicked.current : null;
    onActivate();
    setSelected((prev) => {
      // Ticks left in this order while another was active do not come back.
      const base = active ? prev : NONE;
      const next = new Set(base);
      const turnOn = !base.has(item.id!);
      const from = anchor != null ? Math.min(anchor, idx) : idx;
      const to = anchor != null ? Math.max(anchor, idx) : idx;
      for (const i of selectable.slice(from, to + 1)) {
        if (turnOn) next.add(i.id!);
        else next.delete(i.id!);
      }
      return next;
    });
    lastClicked.current = idx;
  };

  const selectOnly = (list: OrderItem[]) => {
    onActivate();
    setSelected(new Set(list.map((i) => i.id!)));
  };
  const allTicked = selectable.length > 0 && selectable.every((i) => selected.has(i.id!));
  const someTicked = selectable.some((i) => selected.has(i.id!));

  /** Media on the open items, for "select every Vinyl item". */
  const mediaGroups = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    for (const i of selectable) {
      const key = i.media.trim();
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [selectable]);

  const applyBulk = (mode: BulkAssignMode) =>
    bulk.mutate({
      mode,
      assignments: Array.from(selected).map((id) => ({ item_id: id, user_ids: Array.from(teams) })),
    });

  const rowCheckbox = (item: OrderItem) =>
    item.production_completed || closed ? null : (
      <Checkbox
        checked={selected.has(item.id!)}
        onClick={(e) => clickItem(item, e.shiftKey)}
        aria-label={`Select item ${item.s_no}, ${item.media}`}
        className="h-5 w-5 md:h-4 md:w-4"
      />
    );

  const statusFor = (item: OrderItem) =>
    item.is_flagged ? (
      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <Flag className="h-3 w-3" /> Flagged
      </span>
    ) : item.production_completed ? (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Complete
      </span>
    ) : assignedCount(item) > 0 ? (
      <span className="text-xs text-muted-foreground">
        {(item.assignments ?? []).filter((a) => a.completed).length} of {assignedCount(item)} done
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">Unassigned</span>
    );

  const assignFor = (item: OrderItem) => (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full justify-between text-xs font-normal md:h-8"
            disabled={busy || closed}
            aria-label={`Assign teams to item ${item.s_no}, ${item.media}`}
          >
            <span className="flex items-center gap-1.5 truncate">
              <Users className="h-3.5 w-3.5 shrink-0 opacity-60" />
              {assignedCount(item) === 0 ? (
                <span className="text-muted-foreground italic">Unassigned</span>
              ) : (
                plural(assignedCount(item), "team")
              )}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <p className="px-1 pb-2 text-[11px] text-muted-foreground">
            Assign one or more teams. All must finish before the item is complete.
          </p>
          <div className="space-y-1">
            {staff.map((s) => {
              const a = (item.assignments ?? []).find((x) => x.user_id === s.id);
              return (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox checked={!!a} onCheckedChange={() => toggleAssignee(item, s.id)} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {a?.completed && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                </label>
              );
            })}
            {staff.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">No production staff found.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {assignedCount(item) > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.assignments!.map((a) => (
            <span
              key={a.id}
              className={`rounded px-1.5 py-0.5 text-[10px] ${a.completed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
            >
              {a.user?.name ?? `#${a.user_id}`}
              {a.completed ? " ✓" : ""}
            </span>
          ))}
        </div>
      )}
    </>
  );

  return (
    <section className="surface-panel p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{order.order_no}</h3>
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {order.client_name} · {storeLabel(order)}
            {storeSubLabel(order) ? ` (${storeSubLabel(order)})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectable.length > 0 && (
            <SelectMenu
              all={selectable}
              unassigned={openUnassigned}
              mediaGroups={mediaGroups}
              onPick={selectOnly}
            />
          )}
          {openUnassigned.length > 0 && (
            <SuggestButton
              orderId={order.id}
              items={items}
              nameOf={nameOf}
              busy={busy}
              onApply={(assignments) => bulk.mutate({ mode: "add", assignments })}
            />
          )}
          <div className="text-right text-xs">
            <div className="uppercase tracking-wider text-muted-foreground">Production</div>
            <div className="font-semibold">
              {assigned.length === 0
                ? "Nothing assigned"
                : `${done} of ${assigned.length} complete`}
            </div>
          </div>
        </div>
      </div>

      {/* Phones: one row per item instead of a seven-column table per order. */}
      <ul className="divide-y md:hidden">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[auto_1fr] gap-x-3 p-4 text-sm">
            <div className="w-5 pt-0.5">{rowCheckbox(item)}</div>
            <div className="grid min-w-0 gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-muted-foreground">{item.s_no}. </span>
                  <span className="font-medium">{item.media}</span>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    {item.width_inches} x {item.height_inches} in · Qty {item.qty} ·{" "}
                    {(item.total_sft || 0).toFixed(2)} sft
                  </div>
                </div>
                <div className="shrink-0">{statusFor(item)}</div>
              </div>
              <div>{assignFor(item)}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {selectable.length > 0 && (
                  <Checkbox
                    checked={allTicked ? true : someTicked ? "indeterminate" : false}
                    onCheckedChange={() =>
                      allTicked ? setSelected(new Set()) : selectOnly(selectable)
                    }
                    aria-label="Select every open item"
                  />
                )}
              </TableHead>
              <TableHead className="w-12 text-center">#</TableHead>
              <TableHead>Media</TableHead>
              <TableHead className="text-right">Size (in)</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total Sft</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-56">Assigned To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-state={selected.has(item.id!) ? "selected" : undefined}>
                <TableCell>{rowCheckbox(item)}</TableCell>
                <TableCell className="text-center text-muted-foreground">{item.s_no}</TableCell>
                <TableCell className="font-medium">{item.media}</TableCell>
                <TableCell className="text-right">
                  {item.width_inches} x {item.height_inches}
                </TableCell>
                <TableCell className="text-right">{item.qty}</TableCell>
                <TableCell className="text-right">{(item.total_sft || 0).toFixed(2)}</TableCell>
                <TableCell>{statusFor(item)}</TableCell>
                <TableCell>{assignFor(item)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selected.size > 0 && (
        <div
          role="region"
          aria-label={`Assign teams to ${plural(selected.size, "selected item")}`}
          // Fixed, not sticky: the page scrolls the document, and main (overflow-y-auto) would
          // otherwise be the sticky container, so the bar would sit below the last row.
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border bg-popover p-2.5 shadow-lg md:left-[calc(16rem+1.5rem)] md:right-6 lg:left-[calc(18rem+2rem)] lg:right-8"
        >
          <span className="w-full px-1 text-sm font-medium sm:w-auto">
            {order.order_no}: {plural(selected.size, "item")} selected
          </span>
          <div
            className="-mx-1 flex min-w-0 flex-1 basis-full items-center gap-1.5 overflow-x-auto px-1 sm:mx-0 sm:basis-0 sm:flex-wrap sm:overflow-visible sm:px-0"
            role="group"
            aria-label="Teams"
          >
            {staff.map((s) => {
              const on = teams.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setTeams((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                  className={
                    on
                      ? "h-8 shrink-0 whitespace-nowrap rounded-full border border-primary bg-primary/10 px-3 text-xs font-medium text-primary"
                      : "h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs text-muted-foreground hover:bg-muted/60"
                  }
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              disabled={busy || teams.size === 0}
              onClick={() => applyBulk("add")}
              title="Keep the teams already on these items and add the ones picked"
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => applyBulk("replace")}
              title={
                teams.size === 0
                  ? "Take every team off these items"
                  : "These items get exactly the teams picked"
              }
            >
              {teams.size === 0 ? "Clear teams" : "Replace"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => {
                setSelected(new Set());
                setTeams(new Set());
              }}
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {/* Room to scroll the last rows out from under the bar. */}
      {selected.size > 0 && <div className="h-28 md:h-20" aria-hidden />}
    </section>
  );
}

/** Quick ways to tick many items: every open item, only unassigned, or one media. */
function SelectMenu({
  all,
  unassigned,
  mediaGroups,
  onPick,
}: {
  all: OrderItem[];
  unassigned: OrderItem[];
  mediaGroups: [string, OrderItem[]][];
  onPick: (items: OrderItem[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const row = (label: string, list: OrderItem[]) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        onPick(list);
        setOpen(false);
      }}
      disabled={list.length === 0}
      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
    >
      <span className="truncate">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
    </button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Select
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        {row("All open items", all)}
        {row("Unassigned only", unassigned)}
        {mediaGroups.length > 1 && (
          <>
            <div className="mx-2 my-1 border-t" />
            <p className="px-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              By media
            </p>
            <div className="max-h-56 overflow-y-auto">
              {mediaGroups.map(([media, list]) => row(media, list))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Loads suggestions when opened and shows what would happen, grouped by team, before
 * anything is saved. Applying only adds teams to items that have none.
 */
function SuggestButton({
  orderId,
  items,
  nameOf,
  busy,
  onApply,
}: {
  orderId: number;
  items: OrderItem[];
  nameOf: (id: number) => string;
  busy: boolean;
  onApply: (assignments: Assignment[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    // Keyed on who is on each item, so a change since the last look fetches fresh.
    queryKey: [
      "assign-suggestions",
      orderId,
      items.map((i) => `${i.id}:${assignedCount(i)}`).join(","),
    ],
    queryFn: () => fetchAssignSuggestions(orderId),
    enabled: open,
  });
  const suggestions = useMemo(() => data?.suggestions ?? [], [data]);
  const unassigned = items.filter((i) => !i.production_completed && assignedCount(i) === 0).length;

  const groups = useMemo(() => {
    const m = new Map<string, { user_ids: number[]; count: number }>();
    for (const s of suggestions) {
      const key = s.user_ids.join(",");
      const g = m.get(key) ?? { user_ids: s.user_ids, count: 0 };
      g.count += 1;
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [suggestions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Suggest from history
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Looking at past orders…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Couldn't load suggestions. {errorText(error)}</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No history yet for the media on the unassigned items. Assign a few by hand and this will
            learn from them.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Based on which teams usually get each media. Only unassigned items change.
            </p>
            <ul className="space-y-1.5 text-sm">
              {groups.map((g) => (
                <li key={g.user_ids.join(",")} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">{g.user_ids.map(nameOf).join(", ")}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {plural(g.count, "item")}
                  </span>
                </li>
              ))}
              {unassigned > suggestions.length && (
                <li className="flex justify-between gap-3 text-muted-foreground">
                  <span>No history, left unassigned</span>
                  <span className="text-xs tabular-nums">
                    {plural(unassigned - suggestions.length, "item")}
                  </span>
                </li>
              )}
            </ul>
            <Button
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={() => {
                onApply(suggestions.map((s) => ({ item_id: s.item_id, user_ids: s.user_ids })));
                setOpen(false);
              }}
            >
              Assign {plural(suggestions.length, "item")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
