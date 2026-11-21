import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CheckCircle2, Cog, Hourglass, Layers, PlayCircle, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CsmTag } from "@/components/orders/CsmTag";
import { ageDays, ageTone, changeLineMachine, fetchMachineBoard, lineSize, type Machine, type MachineLine } from "@/api/machines";
import { friendlyError } from "@/lib/friendly-error";
import { cn } from "@/lib/utils";

type Lane = { key: string; title: string; machine?: Machine; queued: MachineLine[]; running: MachineLine[] };
const SHOWN = 6;

/**
 * The Production Manager's machine board: one lane per machine with what waits and what runs,
 * and a "needs you" lane for rejected lines and lines with no machine. Any line can be moved to
 * another machine from here; its unfinished work leaves the operator and queues there.
 */
export function MachineBoard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["machine-board"], queryFn: fetchMachineBoard, refetchInterval: 30_000 });
  const move = useMutation({
    mutationFn: (v: { id: number; machine_id: number }) => changeLineMachine(v.id, v.machine_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["machine-board"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Line moved", { description: "It now waits in that machine's queue." });
    },
    onError: (e) => toast.error("Not moved", { description: friendlyError(e) }),
  });

  const view = useMemo(() => {
    if (!data) return null;
    const open = data.lines.filter((l) => !l.production_completed);
    const running = (l: MachineLine) => l.assignments.some((a) => !a.completed);
    const rejected = open.filter((l) => l.returned_at && !running(l));
    const unrouted = open.filter((l) => !l.machine_id && !l.returned_at && l.assignments.length === 0);
    const lanes: Lane[] = data.machines.map((m) => ({
      key: String(m.id),
      title: m.name,
      machine: m,
      queued: open.filter((l) => l.machine_id === m.id && !l.returned_at && l.assignments.length === 0),
      running: open.filter((l) => l.machine_id === m.id && running(l)),
    }));
    // Lines a team was given straight away, with no machine: shown so nothing running hides.
    const teamOnly = open.filter((l) => !l.machine_id && running(l));
    const load = new Map<number, number>();
    for (const l of open) for (const a of l.assignments) if (!a.completed) load.set(a.user_id, (load.get(a.user_id) ?? 0) + 1);
    return {
      lanes,
      rejected,
      unrouted,
      teamOnly,
      load,
      waiting: lanes.reduce((s, l) => s + l.queued.length, 0),
      runningCount: open.filter(running).length,
    };
  }, [data]);

  if (isLoading || !data || !view) return null;

  const machineSelect = (l: MachineLine) => (
    <Select value={l.machine_id ? String(l.machine_id) : ""} onValueChange={(v) => move.mutate({ id: l.id, machine_id: Number(v) })}>
      <SelectTrigger aria-label={`Machine for ${l.media} on ${l.order.order_no}`} className="h-7 w-[118px] text-[11px]">
        <SelectValue placeholder="Machine" />
      </SelectTrigger>
      <SelectContent>
        {data.machines.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const stats = [
    { label: "Waiting on machines", value: view.waiting, icon: Hourglass, tone: "text-sky-600" },
    { label: "Running", value: view.runningCount, icon: PlayCircle, tone: "text-primary" },
    { label: "Needs you", value: view.rejected.length + view.unrouted.length, icon: AlertTriangle, tone: "text-destructive" },
    { label: "Made today", value: data.completed_today, icon: CheckCircle2, tone: "text-emerald-600" },
  ];

  return (
    <section className="mb-6 space-y-4" aria-label="Machine board">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="surface-panel flex items-center gap-3 p-4">
            <s.icon className={cn("h-6 w-6", s.tone)} aria-hidden />
            <div>
              <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {(view.rejected.length > 0 || view.unrouted.length > 0) && (
        <div className="surface-panel border-destructive/30 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Needs you
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rejected by operators ({view.rejected.length})</h3>
              <LaneList lines={view.rejected} empty="None." move={machineSelect} />
            </div>
            <div>
              <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Unplug className="h-3 w-3" aria-hidden /> No machine ({view.unrouted.length})
              </h3>
              <LaneList lines={view.unrouted} empty="None." move={machineSelect} />
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {view.lanes.map((lane) => {
          const ops = data.operators.filter((o) => o.machine_id === lane.machine?.id);
          return (
            <div key={lane.key} className="surface-panel flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Cog className="h-4 w-4 text-primary" aria-hidden /> {lane.title}
                </h3>
                <div className="flex gap-1 text-[11px]">
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-semibold text-sky-700 dark:text-sky-300">{lane.queued.length} waiting</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{lane.running.length} running</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ops.length === 0 ? (
                  <span className="text-[11px] text-destructive">No operator on this machine</span>
                ) : (
                  ops.map((o) => (
                    <span key={o.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                      {o.name}
                      <span className={cn("rounded-full px-1 font-bold", (view.load.get(o.id) ?? 0) > 0 ? "bg-primary/15 text-primary" : "text-muted-foreground")}>
                        {view.load.get(o.id) ?? 0}
                      </span>
                    </span>
                  ))
                )}
              </div>
              <div>
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Waiting</h4>
                <LaneList lines={lane.queued} empty="Queue empty." move={machineSelect} />
              </div>
              <div>
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Running</h4>
                <LaneList lines={lane.running} empty="Nothing running." move={machineSelect} />
              </div>
            </div>
          );
        })}
        {view.teamOnly.length > 0 && (
          <div className="surface-panel flex flex-col gap-3 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Layers className="h-4 w-4 text-muted-foreground" aria-hidden /> Given to a team, no machine
            </h3>
            <LaneList lines={view.teamOnly} empty="" move={machineSelect} />
          </div>
        )}
      </div>
    </section>
  );
}

function LineRow({ l, move }: { l: MachineLine; move?: React.ReactNode }) {
  const days = ageDays(l.order.date);
  const who = l.assignments.filter((a) => !a.completed).map((a) => a.user.name);
  return (
    <li className="grid gap-1 rounded-lg border bg-background/60 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <Link to="/prod-manager/assign" search={{ order: l.order.id }} className="font-mono font-semibold text-primary hover:underline">
          {l.order.order_no}
        </Link>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", ageTone(days))}>{days}d</span>
      </div>
      <div className="truncate" title={`${l.media} · ${l.order.client_name}`}>
        <span className="font-medium">{l.media}</span> <span className="text-muted-foreground">{lineSize(l)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1 truncate">
          <CsmTag id={l.order.created_by} name={l.order.creator_name} compact />
          {who.length > 0 && <span className="truncate">· {who.join(", ")}</span>}
        </span>
        {move}
      </div>
      {l.started_at && who.length > 0 && (
        <div className="text-[10px] text-muted-foreground">started {formatDistanceToNowStrict(new Date(l.started_at), { addSuffix: true })}</div>
      )}
      {l.returned_reason && <div className="text-[11px] text-destructive">Rejected: {l.returned_reason}</div>}
    </li>
  );
}

function LaneList({ lines, empty, move }: { lines: MachineLine[]; empty: string; move: (l: MachineLine) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  if (lines.length === 0) return <p className="px-1 text-[11px] text-muted-foreground">{empty}</p>;
  return (
    <>
      <ul className="grid gap-1.5">
        {(all ? lines : lines.slice(0, SHOWN)).map((l) => (
          <LineRow key={l.id} l={l} move={move(l)} />
        ))}
      </ul>
      {lines.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-[11px] font-medium text-primary hover:underline">
          {all ? "Show fewer" : `+${lines.length - SHOWN} more`}
        </button>
      )}
    </>
  );
}
