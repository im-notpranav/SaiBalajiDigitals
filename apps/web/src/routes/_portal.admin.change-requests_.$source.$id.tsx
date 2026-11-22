import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, Check, ExternalLink, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState, LoadingState } from "@/components/layout/PageStates";
import { Button } from "@/components/ui/button";
import { CsmTag } from "@/components/orders/CsmTag";
import { CHANGE_STATUS_STYLE } from "@/components/orders/RequestChange";
import { DecideDialog } from "@/components/change-requests/DecideDialog";
import { fetchChangeRequestView, type LineEditPayload, type QueueRow, type RateChangePayload } from "@/api/changeRequests";
import { fetchOrder } from "@/api/orders";
import { useAuth } from "@/lib/auth-store";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_portal/admin/change-requests_/$source/$id")({
  head: () => ({ meta: [{ title: "Compare Change — SB OMS" }] }),
  component: ComparePage,
});

/* ------------------------------------------------------------------ the compare model */

type LineState = "same" | "changed" | "new" | "removed" | "focus";
interface Figures {
  media: string;
  width: number;
  height: number;
  qty: number;
  rate: number;
  amount: number;
}
interface DiffLine {
  key: string;
  sNo: number | null;
  now: Figures | null;
  after: Figures | null;
  state: LineState;
  note?: string;
}
interface DiffStore {
  key: string;
  sNo: number | null;
  name: string;
  location: string;
  nameAfter?: string;
  locationAfter?: string;
  state: "same" | "renamed" | "new" | "moved" | "focus";
  lines: DiffLine[];
}

// Same rounding as the API: square feet to 2 places first, then the amount.
const sft = (w: number, h: number, q: number) => Number(((w * h * q) / 144).toFixed(2));
const amountOf = (w: number, h: number, q: number, r: number) => Number((sft(w, h, q) * r).toFixed(2));
const sNoTag = (n: number | null) => (n == null ? "New" : `S${String(n).padStart(2, "0")}`);
const LOSS = new Set(["Reprint", "Sample", "UnderWarranty", "FreeOfCost"]);

const figuresOf = (i: any): Figures => ({
  media: i.media,
  width: Number(i.width_inches),
  height: Number(i.height_inches),
  qty: Number(i.qty),
  rate: Number(i.rate),
  amount: Number(i.amount ?? amountOf(Number(i.width_inches), Number(i.height_inches), Number(i.qty), Number(i.rate))),
});
const plainFigures = (i: { media: string; width_inches: number; height_inches: number; qty: number; rate: number }): Figures => ({
  media: i.media,
  width: Number(i.width_inches),
  height: Number(i.height_inches),
  qty: Number(i.qty),
  rate: Number(i.rate),
  amount: amountOf(Number(i.width_inches), Number(i.height_inches), Number(i.qty), Number(i.rate)),
});

/** The order's stores and lines as they are now, each line marked "same". */
function baseStores(order: any): DiffStore[] {
  const stores: any[] = order?.stores ?? [];
  return stores.map((s) => ({
    key: `s${s.id}`,
    sNo: s.s_no,
    name: s.store_name,
    location: s.location,
    state: "same" as const,
    lines: (s.items ?? []).map((i: any) => ({ key: `i${i.id}`, sNo: i.s_no, now: figuresOf(i), after: null, state: "same" as LineState })),
  }));
}

/**
 * Lays the request over the order: which lines change and to what, which are new or removed,
 * and what the order comes to after approval. A decided request shows the order as it is.
 */
function buildCompare(row: QueueRow, order: any, other: any | null) {
  const stores = baseStores(order);
  const now = Number(order?.total_amount ?? 0);
  let delta = 0;
  let clientAfter: string | undefined;
  const storeById = new Map<number, DiffStore>((order?.stores ?? []).map((s: any, i: number) => [s.id, stores[i]!]));
  const lineById = new Map<number, DiffLine>();
  for (const s of order?.stores ?? []) {
    const st = storeById.get(s.id)!;
    for (const i of s.items ?? []) {
      const l = st.lines.find((x) => x.key === `i${i.id}`);
      if (l) lineById.set(i.id, l);
    }
  }
  const pending = row.status === "PENDING";

  if (pending && row.source === "change" && row.kind === "LINE_EDIT" && row.payload) {
    const p = row.payload as LineEditPayload;
    if (p.client_name && p.client_name !== order.client_name) clientAfter = p.client_name;
    for (const s of p.stores ?? []) {
      const st = storeById.get(s.id);
      if (!st) continue;
      if (s.store_name && s.store_name !== st.name) st.nameAfter = s.store_name;
      if (s.location && s.location !== st.location) st.locationAfter = s.location;
      if (st.nameAfter || st.locationAfter) st.state = "renamed";
    }
    for (const it of p.items ?? []) {
      if (it.id) {
        const l = lineById.get(it.id);
        if (!l || !l.now) continue;
        l.after = plainFigures(it);
        l.state = "changed";
        delta += l.after.amount - l.now.amount;
      } else {
        const st = (it.store_id && storeById.get(it.store_id)) || stores[0];
        if (!st) continue;
        const after = plainFigures(it);
        st.lines.push({ key: `n${st.lines.length}-${it.media}`, sNo: null, now: null, after, state: "new" });
        delta += after.amount;
      }
    }
    for (const id of p.remove_item_ids ?? []) {
      const l = lineById.get(id);
      if (!l || !l.now) continue;
      l.state = "removed";
      delta -= l.now.amount;
    }
    for (const [n, s] of (p.new_stores ?? []).entries()) {
      const lines = s.items.map((it, k) => ({ key: `ns${n}-${k}`, sNo: null, now: null, after: plainFigures(it), state: "new" as LineState }));
      delta += lines.reduce((sum, l) => sum + l.after.amount, 0);
      stores.push({ key: `ns${n}`, sNo: null, name: s.store_name, location: s.location, state: "new", lines });
    }
  } else if (pending && row.source === "change" && row.kind === "RATE_CHANGE" && row.payload) {
    for (const it of (row.payload as RateChangePayload).items ?? []) {
      const l = lineById.get(it.id);
      if (!l || !l.now) continue;
      const after = { ...l.now, rate: it.asked, amount: amountOf(l.now.width, l.now.height, l.now.qty, it.asked) };
      l.after = after;
      l.state = "changed";
      l.note = `Rate card ₹${it.card}, CSM asked ₹${it.asked}`;
      delta += after.amount - l.now.amount;
    }
  } else if (pending && row.source === "change" && row.kind === "COMBINE_ORDERS" && other) {
    for (const s of baseStores(other)) {
      stores.push({
        ...s,
        key: `o${s.key}`,
        state: "moved",
        lines: s.lines.map((l) => ({ ...l, key: `o${l.key}`, after: l.now, now: null, state: "new" as LineState, note: `From ${other.order_no}` })),
      });
    }
    delta += Number(other.total_amount ?? 0);
  } else if (pending && row.source === "adjustment") {
    const st = row.store_id ? storeById.get(row.store_id) : undefined;
    if (st) st.state = "focus";
    delta += (row.kind === "ExtraAmount" ? 1 : -1) * Number(row.amount ?? 0);
  } else if (pending && row.source === "line_remark" && row.item_id) {
    const l = lineById.get(row.item_id);
    if (l && l.now) {
      l.state = "focus";
      l.note = `${row.label}${row.reason ? `: ${row.reason}` : ""}`;
      if (LOSS.has(row.kind)) {
        l.after = { ...l.now, amount: 0 };
        delta -= l.now.amount;
      }
    }
  }

  const changes =
    stores.reduce((n, s) => n + s.lines.filter((l) => l.state !== "same").length + (s.state !== "same" ? 1 : 0), 0) + (clientAfter ? 1 : 0);
  return { stores, now, delta: Number(delta.toFixed(2)), after: Number((now + delta).toFixed(2)), clientAfter, changes, compared: pending };
}

/* ------------------------------------------------------------------ the page */

function ComparePage() {
  const { source, id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);

  const view = useQuery({ queryKey: ["change-requests", "view", source, id], queryFn: () => fetchChangeRequestView(source, Number(id)) });
  const row = view.data?.request;
  const orderQ = useQuery({ queryKey: ["order", String(row?.order.id)], queryFn: () => fetchOrder(row!.order.id), enabled: !!row });
  const otherQ = useQuery({
    queryKey: ["order", String(row?.other_order_id)],
    queryFn: () => fetchOrder(row!.other_order_id!),
    enabled: !!row?.other_order_id && row.kind === "COMBINE_ORDERS",
  });
  const order: any = orderQ.data?.order;
  const other: any = otherQ.data?.order ?? null;
  const model = useMemo(() => (row && order ? buildCompare(row, order, other) : null), [row, order, other]);

  if (view.isLoading || (row && orderQ.isLoading)) return <LoadingState />;
  if (view.error || !row) return <ErrorState error={view.error} onRetry={() => view.refetch()} />;
  if (orderQ.error || !order || !model) return <ErrorState error={orderQ.error} onRetry={() => orderQ.refetch()} />;

  const pending = row.status === "PENDING";
  const canDecide = user?.role === "ADMIN" && pending;

  return (
    <>
      <PageHeader
        title={`${row.label} · ${row.order.order_no}`}
        description={`${row.order.client_name} · asked by ${row.requester?.name ?? "—"} on ${format(new Date(row.created_at), "dd MMM yyyy, h:mm a")}`}
        crumbs={[{ label: "Automated System" }, { label: "Change Requests", to: "/admin/change-requests" }, { label: row.order.order_no }]}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link to="/admin/change-requests">
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Queue
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/orders/$id" params={{ id: String(row.order.id) }}>
                <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Open order
              </Link>
            </Button>
            {canDecide && (
              <>
                <Button variant="outline" onClick={() => setDeciding("reject")}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden /> Reject
                </Button>
                <Button onClick={() => setDeciding("approve")}>
                  <Check className="mr-1.5 h-4 w-4" aria-hidden /> Approve
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* What was asked, in words. */}
          <section className="surface-panel space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", CHANGE_STATUS_STYLE[row.status])}>{row.status.toLowerCase()}</span>
              <CsmTag id={row.order.created_by} name={row.order.creator_name} compact />
              {model.clientAfter && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                  Client {row.order.client_name} <ArrowRight className="h-3 w-3" aria-hidden /> {model.clientAfter}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm">{row.summary}</p>
            {row.reason && row.kind !== "OTHER" && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Reason:</span> {row.reason}
              </p>
            )}
            {row.decided_at && (
              <p className="text-xs text-muted-foreground">
                {row.status.toLowerCase()} by {row.decider?.name ?? "admin"} on {format(new Date(row.decided_at), "dd MMM yyyy, h:mm a")}
                {row.decision_note && ` · ${row.decision_note}`}
              </p>
            )}
          </section>

          {/* The order, line by line, with the asked change laid over it. */}
          <section className="surface-panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{model.compared ? "The order now, and after approval" : "The order as it is now"}</h2>
              {model.compared && model.changes > 0 && (
                <div className="flex items-center gap-3">
                  <Legend />
                  <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="radiogroup" aria-label="Which lines to show">
                    {[false, true].map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        role="radio"
                        aria-checked={onlyChanges === v}
                        onClick={() => setOnlyChanges(v)}
                        className={cn("rounded-md px-2.5 py-1 font-medium", onlyChanges === v ? "bg-background shadow-sm" : "text-muted-foreground")}
                      >
                        {v ? "Only changes" : "All lines"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {!pending && (
              <p className="mb-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                This request is decided, so there is nothing left to compare.{" "}
                {row.status === "APPROVED" ? "The change is already in the figures below." : "The order was left as it was."}
              </p>
            )}
            <div className="space-y-4">
              {model.stores
                .filter((s) => !onlyChanges || s.state !== "same" || s.lines.some((l) => l.state !== "same"))
                .map((s) => (
                  <StoreTable key={s.key} store={s} onlyChanges={onlyChanges} />
                ))}
            </div>
          </section>
        </div>

        {/* What it comes to. */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:h-fit">
          <section className="surface-panel overflow-hidden">
            <div className="space-y-2 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order total now</span>
                <span className="tabular-nums">{inr(model.now)}</span>
              </div>
              {model.compared && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">This change</span>
                    <span className={cn("font-medium tabular-nums", model.delta > 0 ? "text-emerald-600" : model.delta < 0 ? "text-destructive" : "")}>
                      {model.delta > 0 ? "+" : model.delta < 0 ? "−" : ""}
                      {inr(Math.abs(model.delta))}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2 text-base font-semibold">
                    <span>After approval</span>
                    <span className="tabular-nums">{inr(Math.max(0, model.after))}</span>
                  </div>
                </>
              )}
            </div>
            {canDecide && (
              <div className="grid grid-cols-2 gap-2 border-t bg-muted/20 p-3">
                <Button variant="outline" onClick={() => setDeciding("reject")}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden /> Reject
                </Button>
                <Button onClick={() => setDeciding("approve")}>
                  <Check className="mr-1.5 h-4 w-4" aria-hidden /> Approve
                </Button>
              </div>
            )}
          </section>
          {model.compared && (
            <p className="px-1 text-xs text-muted-foreground">
              {model.changes} change{model.changes === 1 ? "" : "s"} asked. The total is worked out from the lines; Extra / Less Amounts
              already on the order stay as they are.
            </p>
          )}
        </aside>
      </div>

      {deciding && (
        <DecideDialog row={row} action={deciding} onClose={() => setDeciding(null)} onDecided={() => navigate({ to: "/admin/change-requests" })} />
      )}
    </>
  );
}

function Legend() {
  const dot = (c: string, label: string) => (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-2 w-2 rounded-full", c)} aria-hidden />
      {label}
    </span>
  );
  return (
    <span className="hidden items-center gap-2.5 text-[11px] text-muted-foreground md:flex">
      {dot("bg-amber-500", "changed")}
      {dot("bg-emerald-500", "new")}
      {dot("bg-destructive", "removed")}
    </span>
  );
}

const ROW_TONE: Record<LineState, string> = {
  same: "",
  changed: "bg-amber-500/[0.07]",
  new: "bg-emerald-500/[0.07]",
  removed: "bg-destructive/[0.06] text-muted-foreground",
  focus: "bg-violet-500/[0.08]",
};
const ROW_MARK: Record<LineState, string> = {
  same: "border-l-transparent",
  changed: "border-l-amber-500",
  new: "border-l-emerald-500",
  removed: "border-l-destructive",
  focus: "border-l-violet-500",
};
const STORE_BADGE: Record<DiffStore["state"], { text: string; cls: string } | null> = {
  same: null,
  renamed: { text: "renamed", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  new: { text: "new store", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  moved: { text: "moves in", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  focus: { text: "billed with this store", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
};

function StoreTable({ store, onlyChanges }: { store: DiffStore; onlyChanges: boolean }) {
  const lines = onlyChanges ? store.lines.filter((l) => l.state !== "same") : store.lines;
  const badge = STORE_BADGE[store.state];
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm">
        <span className="font-mono text-xs font-semibold text-muted-foreground">{sNoTag(store.sNo)}</span>
        <Changed now={store.name} after={store.nameAfter} className="font-medium" />
        <span className="text-muted-foreground">·</span>
        <Changed now={store.location} after={store.locationAfter} className="text-muted-foreground" />
        {badge && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", badge.cls)}>{badge.text}</span>}
      </div>
      {lines.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No lines.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="w-10 px-3 py-1.5 text-left font-medium">#</th>
                <th className="px-2 py-1.5 text-left font-medium">Line item</th>
                <th className="px-2 py-1.5 text-right font-medium">Size (in)</th>
                <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium">Rate</th>
                <th className="px-3 py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const base = (l.now ?? l.after)!;
                // Only a saved line that changes shows old beside new; a new line is all new.
                const next = <K extends keyof Figures>(k: K) => (l.now && l.after && l.after[k] !== l.now[k] ? l.after[k] : undefined);
                const size = (f: Figures) => `${f.width}×${f.height}`;
                const nextSize = l.now && l.after && size(l.after) !== size(l.now) ? size(l.after) : undefined;
                return (
                  <tr key={l.key} className={cn("border-b border-l-4 last:border-b-0", ROW_TONE[l.state], ROW_MARK[l.state])}>
                    <td className="px-3 py-1.5 align-top text-xs tabular-nums text-muted-foreground">{l.sNo ?? "+"}</td>
                    <td className="px-2 py-1.5 align-top">
                      <span className={cn(l.state === "removed" && "line-through")}>
                        <Changed now={base.media} after={next("media")} />
                      </span>
                      {l.state === "removed" && <span className="ml-2 text-[10px] font-semibold uppercase text-destructive">removed</span>}
                      {l.state === "new" && <span className="ml-2 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">new</span>}
                      {l.note && <div className="text-[11px] text-muted-foreground">{l.note}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right align-top tabular-nums">
                      <Changed now={size(base)} after={nextSize} />
                    </td>
                    <td className="px-2 py-1.5 text-right align-top tabular-nums">
                      <Changed now={String(base.qty)} after={next("qty") != null ? String(next("qty")) : undefined} />
                    </td>
                    <td className="px-2 py-1.5 text-right align-top tabular-nums">
                      <Changed now={`₹${base.rate}`} after={next("rate") != null ? `₹${next("rate")}` : undefined} />
                    </td>
                    <td className="px-3 py-1.5 text-right align-top font-medium tabular-nums">
                      <Changed now={inr(base.amount)} after={next("amount") != null ? inr(Number(next("amount"))) : undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A value, or the old value struck through beside the asked one. */
function Changed({ now, after, className }: { now: string; after?: string; className?: string }) {
  if (after == null || after === now) return <span className={className}>{now}</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center justify-end gap-1", className)}>
      <span className="text-muted-foreground line-through decoration-1">{now}</span>
      <ArrowRight className="h-3 w-3 shrink-0 text-amber-600" aria-hidden />
      <span className="font-semibold text-amber-800 dark:text-amber-300">{after}</span>
    </span>
  );
}
