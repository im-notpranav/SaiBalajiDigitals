import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, HardHat, Search, X } from "lucide-react";
import { apiFetch } from "@/api/client";
import { fetchWorkJobs } from "@/api/allocation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRowLink } from "@/hooks/useRowLink";
import { inr } from "@/lib/format";
import { STAGE_ORDER, STAGE_STYLES, type StageKey } from "@/lib/order-stage";
import { cn } from "@/lib/utils";

/**
 * The Operation Manager's view of open work: every open order in one table, aged from the
 * order date (0–5 days green, 6–10 orange, 11+ red), with where it is stuck, filters, search
 * and sorting; and today's field jobs as dense sheet-style rows (OMS-WAS).
 */

interface PendingRow {
  id: number;
  order_no: string;
  client_name: string;
  date: string;
  status: string;
  stage: StageKey;
  days: number;
  tone: "green" | "orange" | "red";
  value: number;
  locations: string;
}
interface PendingGroup {
  csm_id: number | null;
  csm: string;
  local: PendingRow[];
  non_local: PendingRow[];
  total: number;
  oldest: number;
  tones: { green: number; orange: number; red: number };
}
type Row = PendingRow & { csm: string; csmKey: string; area: "local" | "non_local" };
type Tone = PendingRow["tone"];
type SortKey = "days" | "value" | "csm" | "client" | "stage" | "order";

const TONE_TEXT: Record<Tone, string> = { green: "text-success", orange: "text-warning", red: "text-destructive" };
const TONE_DOT: Record<Tone, string> = { green: "bg-success", orange: "bg-warning", red: "bg-destructive" };
const TONE_LABEL: Record<Tone, string> = { green: "0–5 days", orange: "6–10 days", red: "11+ days" };
const PAGE = 40;

export function OmPendingBoard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "pending-by-csm"],
    queryFn: () => apiFetch<{ csms: PendingGroup[]; total: number }>("/dashboard/pending-by-csm"),
    refetchInterval: 120_000,
  });
  const link = useRowLink();
  const [q, setQ] = useState("");
  const [tone, setTone] = useState<Tone | "all">("all");
  const [area, setArea] = useState<"all" | "local" | "non_local">("all");
  const [stage, setStage] = useState<StageKey | "all">("all");
  const [csm, setCsm] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "days", desc: true });
  const [shown, setShown] = useState(PAGE);

  const rows: Row[] = useMemo(
    () =>
      (data?.csms ?? []).flatMap((g) => {
        const csmKey = String(g.csm_id ?? g.csm);
        return [
          ...g.local.map((r) => ({ ...r, csm: g.csm, csmKey, area: "local" as const })),
          ...g.non_local.map((r) => ({ ...r, csm: g.csm, csmKey, area: "non_local" as const })),
        ];
      }),
    [data],
  );

  // Every filter but the one a tile stands for, so the tile shows what picking it would give.
  const matches = (r: Row, skip?: "tone" | "area" | "stage" | "csm") => {
    const needle = q.trim().toLowerCase();
    return (
      (skip === "tone" || tone === "all" || r.tone === tone) &&
      (skip === "area" || area === "all" || r.area === area) &&
      (skip === "stage" || stage === "all" || r.stage === stage) &&
      (skip === "csm" || csm === "all" || r.csmKey === csm) &&
      (!needle || r.order_no.toLowerCase().includes(needle) || r.client_name.toLowerCase().includes(needle) || r.locations.toLowerCase().includes(needle))
    );
  };

  const filtered = useMemo(() => {
    const out = rows.filter((r) => matches(r));
    const dir = sort.desc ? -1 : 1;
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      days: (a, b) => a.days - b.days,
      value: (a, b) => a.value - b.value,
      csm: (a, b) => a.csm.localeCompare(b.csm),
      client: (a, b) => a.client_name.localeCompare(b.client_name),
      stage: (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage),
      order: (a, b) => a.order_no.localeCompare(b.order_no),
    };
    return out.sort((a, b) => dir * by[sort.key](a, b) || b.days - a.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, tone, area, stage, csm, sort]);

  const toneCount = (t: Tone) => rows.filter((r) => r.tone === t && matches(r, "tone")).length;
  const areaCount = (a: Row["area"]) => rows.filter((r) => r.area === a && matches(r, "area")).length;
  const stageCount = (s: StageKey) => rows.filter((r) => r.stage === s && matches(r, "stage")).length;
  const filteredValue = filtered.reduce((sum, r) => sum + r.value, 0);
  const csmOptions = useMemo(
    () =>
      (data?.csms ?? [])
        .map((g) => ({ key: String(g.csm_id ?? g.csm), name: g.csm, total: g.total, red: g.tones.red }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const anyFilter = q.trim() !== "" || tone !== "all" || area !== "all" || stage !== "all" || csm !== "all";
  const clear = () => {
    setQ("");
    setTone("all");
    setArea("all");
    setStage("all");
    setCsm("all");
  };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === "days" || key === "value" }));

  if (isLoading) return <section className="surface-panel h-64 animate-pulse" aria-label="Loading pending orders" />;
  if (!data) return null;

  return (
    <section className="surface-panel p-4 sm:p-5" aria-labelledby="pending-orders">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pending-orders" className="text-base font-semibold">
          Pending orders
        </h2>
        <p className="text-xs text-muted-foreground">Aged from the order date · refreshes every 2 minutes</p>
      </div>

      {/* Tiles: each one is also a filter. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={anyFilter ? "Showing" : "Open orders"} value={String(filtered.length)} sub={`${inr(filteredValue)} value`} active={!anyFilter} onClick={clear} />
        {(["red", "orange", "green"] as const).map((t) => (
          <Tile
            key={t}
            label={TONE_LABEL[t]}
            value={String(toneCount(t))}
            dot={TONE_DOT[t]}
            valueClass={TONE_TEXT[t]}
            active={tone === t}
            onClick={() => setTone(tone === t ? "all" : t)}
          />
        ))}
        <Tile label="Hyderabad" value={String(areaCount("local"))} active={area === "local"} onClick={() => setArea(area === "local" ? "all" : "local")} />
        <Tile label="Non-local" value={String(areaCount("non_local"))} active={area === "non_local"} onClick={() => setArea(area === "non_local" ? "all" : "non_local")} />
      </div>

      {/* Stage chips, then search and CSM. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Stage">
        {STAGE_ORDER.filter((s) => s !== "completed").map((s) => {
          const n = stageCount(s);
          const on = stage === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setStage(on ? "all" : s)}
              disabled={n === 0 && !on}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                on ? STAGE_STYLES[s].badge : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {STAGE_STYLES[s].label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Order no, client or location"
            className="h-9 pl-8"
            aria-label="Search pending orders"
          />
        </div>
        <Select value={csm} onValueChange={setCsm}>
          <SelectTrigger className="h-9 w-full sm:w-56" aria-label="CSM">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every CSM</SelectItem>
            {csmOptions.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.name} · {c.total}
                {c.red ? ` (${c.red} late)` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {anyFilter && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No open orders." : "No open order matches these filters."}
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-lg sm:border">
          <table className="w-full min-w-[52rem] text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <SortTh label="Order" k="order" sort={sort} onSort={sortBy} className="pl-4 sm:pl-3" />
                <SortTh label="Client" k="client" sort={sort} onSort={sortBy} />
                <SortTh label="CSM" k="csm" sort={sort} onSort={sortBy} />
                <th className="px-2 py-2 font-medium">Area</th>
                <SortTh label="Stage" k="stage" sort={sort} onSort={sortBy} />
                <SortTh label="Value" k="value" sort={sort} onSort={sortBy} align="right" />
                <SortTh label="Age" k="days" sort={sort} onSort={sortBy} align="right" />
                <th className="px-3 py-2">
                  <span className="sr-only">Assign</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map((r) => {
                const { className, ...handlers } = link({ to: "/admin/orders/$id", params: { id: String(r.id) } });
                return (
                  <tr key={r.id} {...handlers} className={cn("border-t transition-colors hover:bg-muted/40", className)}>
                    <td className="whitespace-nowrap py-1.5 pl-4 pr-2 sm:pl-3">
                      <span className={cn("mr-2 inline-block h-2 w-2 rounded-full align-middle", TONE_DOT[r.tone])} aria-hidden />
                      <span className="font-mono font-semibold text-primary">{r.order_no}</span>
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-1.5" title={r.locations}>
                      {r.client_name}
                    </td>
                    <td className="max-w-[9rem] truncate whitespace-nowrap px-2 py-1.5">{r.csm}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{r.area === "local" ? "Hyd" : "Non-local"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={cn("rounded border px-1.5 py-0.5 text-[11px] font-medium", STAGE_STYLES[r.stage]?.badge)}>
                        {STAGE_STYLES[r.stage]?.label ?? r.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{inr(r.value)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right" title={`Ordered ${format(new Date(r.date), "dd MMM yyyy")}`}>
                      <span className={cn("font-semibold tabular-nums", TONE_TEXT[r.tone])}>{r.days}d</span>
                    </td>
                    <td className="py-1.5 pl-2 pr-3 text-right">
                      <Link
                        to="/admin/orders/$id"
                        params={{ id: String(r.id) }}
                        hash="field-work"
                        className="rounded border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted"
                        title="Open the order to assign field work"
                      >
                        Assign
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > shown && (
        <div className="mt-2 flex justify-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE * 3)} className="rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
            Show more · {filtered.length - shown} left
          </button>
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  dot,
  valueClass,
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  dot?: string;
  valueClass?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary/60 bg-primary/5" : "bg-card hover:border-primary/30",
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {dot && <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />}
        {label}
      </span>
      <span className={cn("mt-0.5 block text-xl font-bold tabular-nums", valueClass)}>{value}</span>
      {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  );
}

function SortTh({
  label,
  k,
  sort,
  onSort,
  align,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  align?: "right";
  className?: string;
}) {
  const on = sort.key === k;
  return (
    <th className={cn("px-2 py-2 font-medium", align === "right" && "text-right", className)} aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-0.5 hover:text-foreground", on && "text-foreground")}>
        {label}
        {on && (sort.desc ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
}

const IST_MS = 330 * 60_000;
const todayIst = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const JOB_STATUS: Record<string, string> = {
  ASSIGNED: "text-muted-foreground",
  IN_PROGRESS: "text-info",
  COMPLETED: "text-success",
  HOLD: "text-warning",
  CANCELLED: "text-destructive",
};

/** OMS-WAS today: every field job on today's date, one dense row each. */
export function OmsWasToday() {
  const day = todayIst();
  const { data, isLoading } = useQuery({ queryKey: ["work-jobs", "today-rows", day], queryFn: () => fetchWorkJobs({ from: day, to: day }), refetchInterval: 120_000 });
  const link = useRowLink();
  const jobs = data?.jobs ?? [];
  return (
    <section className="surface-panel p-4 sm:p-5" aria-labelledby="oms-was-today">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="oms-was-today" className="flex items-center gap-2 text-base font-semibold">
          <HardHat className="h-4 w-4 text-primary" /> OMS-WAS today
        </h2>
        <Link to="/admin/board" className="text-xs font-medium text-primary hover:underline">Open the board</Link>
      </div>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
      ) : jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No field jobs booked for today.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Order</th>
                <th className="px-2 py-1.5 font-medium">Client</th>
                <th className="px-2 py-1.5 font-medium">Area</th>
                <th className="px-2 py-1.5 font-medium">Team</th>
                <th className="px-2 py-1.5 font-medium">CSM</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const { className, ...handlers } = link(j.order ? { to: "/admin/orders/$id", params: { id: String(j.order.id) } } : null);
                return (
                  <tr key={j.id} {...handlers} className={cn("border-t", className)}>
                    <td className="whitespace-nowrap px-3 py-1 font-mono font-semibold text-primary">{j.order?.order_no ?? j.label}</td>
                    <td className="max-w-[12rem] truncate px-2 py-1">{j.order?.client_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {j.area?.name ?? "—"}
                      {j.locality === "NON_LOCAL" && <span className="ml-1 text-muted-foreground">(NL)</span>}
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-1" title={j.members.map((m) => m.name).join(", ")}>{j.members.map((m) => m.name).join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1">{j.csm?.name ?? j.order?.creator_name ?? "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-1 font-medium", JOB_STATUS[j.status] ?? "")}>
                      {j.status.charAt(0) + j.status.slice(1).toLowerCase().replace(/_/g, " ")}
                      {j.field_flag && <span className="ml-1 text-warning">· {j.field_flag.toLowerCase()}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
