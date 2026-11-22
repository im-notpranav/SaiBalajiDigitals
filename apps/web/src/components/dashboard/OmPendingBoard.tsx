import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, HardHat } from "lucide-react";
import { apiFetch } from "@/api/client";
import { fetchWorkJobs } from "@/api/allocation";
import { useRowLink } from "@/hooks/useRowLink";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The Operation Manager's view of open work: open orders grouped by CSM and Hyderabad /
 * Non-local, aged from the order date (0–5 days green, 6–10 orange, 11+ red, oldest first),
 * and today's field jobs as dense sheet-style rows (OMS-WAS).
 */

interface PendingRow {
  id: number;
  order_no: string;
  client_name: string;
  date: string;
  status: string;
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

const TONE: Record<PendingRow["tone"], string> = {
  green: "bg-success/15 text-success",
  orange: "bg-warning/20 text-warning",
  red: "bg-destructive/15 text-destructive",
};
const DOT: Record<PendingRow["tone"], string> = { green: "bg-success", orange: "bg-warning", red: "bg-destructive" };

export function OmPendingBoard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "pending-by-csm"],
    queryFn: () => apiFetch<{ csms: PendingGroup[]; total: number }>("/dashboard/pending-by-csm"),
    refetchInterval: 120_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <section className="surface-panel h-40 animate-pulse" aria-label="Loading pending orders" />;
  if (!data) return null;
  return (
    <section className="surface-panel p-4 sm:p-5" aria-labelledby="pending-by-csm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pending-by-csm" className="text-base font-semibold">Pending orders by CSM</h2>
        <p className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> 0–5 days</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> 6–10</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> 11+</span>
          <span>· {data.total} open</span>
        </p>
      </div>
      {data.csms.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No open orders.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {data.csms.map((g) => {
            const key = String(g.csm_id ?? g.csm);
            const isOpen = open === key;
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{g.csm}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">Hyd {g.local.length} · Non-local {g.non_local.length}</span>
                  <span className="flex gap-1 text-xs tabular-nums">
                    {(["red", "orange", "green"] as const).map((t) =>
                      g.tones[t] ? (
                        <span key={t} className={cn("rounded px-1.5 py-0.5 font-semibold", TONE[t])}>{g.tones[t]}</span>
                      ) : null,
                    )}
                  </span>
                  <span className="w-20 text-right text-xs text-muted-foreground">oldest {g.oldest}d</span>
                </button>
                {isOpen && (
                  <div className="grid gap-3 bg-muted/20 px-3 pb-3 pt-1 lg:grid-cols-2">
                    <PendingList title="Hyderabad" rows={g.local} />
                    <PendingList title="Non-local" rows={g.non_local} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PendingList({ title, rows }: { title: string; rows: PendingRow[] }) {
  const link = useRowLink();
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title} · {rows.length}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r) => {
              const { className, ...handlers } = link({ to: "/admin/orders/$id", params: { id: String(r.id) } });
              return (
                <tr key={r.id} {...handlers} className={cn("border-t first:border-t-0", className)}>
                  <td className="py-1 pr-2">
                    <span className={cn("inline-block h-2 w-2 rounded-full", DOT[r.tone])} aria-hidden />
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2 font-mono font-semibold text-primary">{r.order_no}</td>
                  <td className="max-w-[10rem] truncate py-1 pr-2" title={r.locations}>{r.client_name}</td>
                  <td className="whitespace-nowrap py-1 pr-2 text-muted-foreground">{r.status.replace(/([a-z])([A-Z])/g, "$1 $2")}</td>
                  <td className="whitespace-nowrap py-1 pr-2 text-right tabular-nums">{inr(r.value)}</td>
                  <td className={cn("whitespace-nowrap py-1 text-right font-semibold tabular-nums", r.tone === "red" ? "text-destructive" : r.tone === "orange" ? "text-warning" : "text-success")}>
                    {r.days}d
                  </td>
                  <td className="py-1 pl-2 text-right">
                    <Link
                      to="/admin/orders/$id"
                      params={{ id: String(r.id) }}
                      hash="field-work"
                      onClick={(e) => e.stopPropagation()}
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
      )}
    </div>
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
